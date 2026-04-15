import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || '';
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || '';
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = 'https://codeassist.google.com/authcode';
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'gemini-cli-oauth-credentials.json');

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function createPkcePair() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(64));
  const codeChallenge = sha256Base64Url(codeVerifier);
  return { codeVerifier, codeChallenge };
}

function createState() {
  return crypto.randomBytes(32).toString('hex');
}

function buildAuthUrl({ state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('scope', OAUTH_SCOPE.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

function extractCallbackParams(callbackUrl) {
  let parsed;
  try {
    parsed = new URL(callbackUrl.trim());
  } catch {
    throw new Error('回调地址不是合法 URL。');
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  const error = parsed.searchParams.get('error');
  const errorDescription = parsed.searchParams.get('error_description');

  if (error) {
    throw new Error(`授权失败: ${error}${errorDescription ? ` (${errorDescription})` : ''}`);
  }

  if (!code) {
    throw new Error('回调地址里缺少 code 参数。');
  }

  if (!state) {
    throw new Error('回调地址里缺少 state 参数。');
  }

  return { code, state };
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error_description' in data
        ? String(data.error_description)
        : data && typeof data === 'object' && 'error' in data
          ? String(data.error)
          : `HTTP ${response.status}`;
    throw new Error(`换取 token 失败: ${message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('token 响应格式不正确。');
  }

  return data;
}

function formatCredentialPayload(tokens) {
  const now = Date.now();
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : undefined;
  const expiryDate = expiresIn ? now + expiresIn * 1000 : undefined;

  return {
    access_token: typeof tokens.access_token === 'string' ? tokens.access_token : undefined,
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
    scope: typeof tokens.scope === 'string' ? tokens.scope : OAUTH_SCOPE.join(' '),
    token_type: typeof tokens.token_type === 'string' ? tokens.token_type : undefined,
    expiry_date: expiryDate,
    obtained_at: new Date(now).toISOString(),
    redirect_uri: REDIRECT_URI,
    client_id: OAUTH_CLIENT_ID,
  };
}

async function saveCredentials(filePath, credentials) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
}

async function main() {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    throw new Error(
      '缺少 GOOGLE_OAUTH_CLIENT_ID 或 GOOGLE_OAUTH_CLIENT_SECRET 环境变量，请先导出后再运行。'
    );
  }

  const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT_PATH;
  const { codeVerifier, codeChallenge } = createPkcePair();
  const expectedState = createState();
  const authUrl = buildAuthUrl({ state: expectedState, codeChallenge });

  output.write('\n=== Gemini CLI 最小 OAuth 授权脚本 ===\n\n');
  output.write('1. 在浏览器中打开下面这个授权 URL。\n');
  output.write('2. 完成授权后，把浏览器最终跳转到的完整回调地址粘贴回来。\n');
  output.write(`3. 成功后凭证会保存到: ${outputPath}\n\n`);
  output.write(`${authUrl}\n\n`);

  const rl = readline.createInterface({ input, output });

  try {
    const callbackUrl = await rl.question('请输入完整回调 URL: ');
    const { code, state } = extractCallbackParams(callbackUrl);

    if (state !== expectedState) {
      throw new Error('state 不匹配，可能是回调地址过期或不是本次授权生成的链接。');
    }

    output.write('\n正在换取 token...\n');
    const tokens = await exchangeCodeForTokens({ code, codeVerifier });
    const credentials = formatCredentialPayload(tokens);
    await saveCredentials(outputPath, credentials);

    output.write('授权成功。\n');
    output.write(`access_token: ${credentials.access_token ? '已获取' : '缺失'}\n`);
    output.write(`refresh_token: ${credentials.refresh_token ? '已获取' : '缺失'}\n`);
    output.write(`保存路径: ${outputPath}\n`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[错误] ${message}\n`);
  process.exitCode = 1;
});
