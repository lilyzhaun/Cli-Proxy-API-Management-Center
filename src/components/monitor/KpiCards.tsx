import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageData } from '@/pages/MonitorPage';
import { collectUsageDetails, calculateCost, type ModelPrice } from '@/utils/usage';
import styles from '@/pages/MonitorPage.module.scss';

interface KpiCardsProps {
  data: UsageData | null;
  loading: boolean;
  timeRange: number;
  modelPrices: Record<string, ModelPrice>;
}

// 格式化数字
function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(2) + 'B';
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K';
  }
  return num.toLocaleString();
}

export function KpiCards({ data, loading, timeRange, modelPrices }: KpiCardsProps) {
  const { t } = useTranslation();

  // 计算统计数据
  const stats = useMemo(() => {
    if (!data?.apis) {
      return {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        successRate: 0,
        consecutiveSuccesses: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        avgTpm: 0,
        avgRpm: 0,
        avgRpd: 0,
        totalCost: 0,
      };
    }

    // 使用 collectUsageDetails 收集所有详情（会自动添加 __modelName）
    const allDetails = collectUsageDetails(data);

    // 按时间排序（最新的在最后）
    allDetails.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let totalRequests = 0;
    let successRequests = 0;
    let failedRequests = 0;
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cachedTokens = 0;
    let totalCost = 0;

    let consecutiveSuccesses = 0;
    for (let i = allDetails.length - 1; i >= 0; i--) {
      if (!allDetails[i].failed) {
        consecutiveSuccesses++;
      } else {
        break;
      }
    }

    const timestamps: number[] = [];

    allDetails.forEach((detail) => {
      totalRequests++;
      if (detail.failed) {
        failedRequests++;
      } else {
        successRequests++;
      }

      totalTokens += detail.tokens.total_tokens || 0;
      inputTokens += detail.tokens.input_tokens || 0;
      outputTokens += detail.tokens.output_tokens || 0;
      reasoningTokens += detail.tokens.reasoning_tokens || 0;
      cachedTokens += detail.tokens.cached_tokens || 0;

      totalCost += calculateCost(detail, modelPrices);
      timestamps.push(new Date(detail.timestamp).getTime());
    });

    const successRate = totalRequests > 0 ? (successRequests / totalRequests) * 100 : 0;

    // 计算 TPM 和 RPM（基于实际时间跨度）
    let avgTpm = 0;
    let avgRpm = 0;
    let avgRpd = 0;

    if (timestamps.length > 0) {
      const minTime = Math.min(...timestamps);
      const maxTime = Math.max(...timestamps);
      const timeSpanMinutes = Math.max((maxTime - minTime) / (1000 * 60), 1);
      const timeSpanDays = Math.max(timeSpanMinutes / (60 * 24), 1);

      avgTpm = Math.round(totalTokens / timeSpanMinutes);
      avgRpm = Math.round((totalRequests / timeSpanMinutes) * 10) / 10;
      avgRpd = Math.round(totalRequests / timeSpanDays);
    }

    return {
      totalRequests,
      successRequests,
      failedRequests,
      successRate,
      consecutiveSuccesses,
      totalTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedTokens,
      avgTpm,
      avgRpm,
      avgRpd,
      totalCost,
    };
  }, [data, modelPrices]);

  const timeRangeLabel =
    timeRange === 1 ? t('monitor.today') : t('monitor.last_n_days', { n: timeRange });

  return (
    <div className={styles.kpiGrid}>
      {/* 请求数 */}
      <div className={styles.kpiCard}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.requests')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>{loading ? '--' : formatNumber(stats.totalRequests)}</div>
        <div className={styles.kpiMeta}>
          <span style={{ color: '#3b82f6' }}>
            {t('monitor.kpi.success')}: {loading ? '--' : stats.successRequests.toLocaleString()}{' '}
            {t('monitor.kpi.failed')}: {loading ? '--' : stats.failedRequests.toLocaleString()}{' '}
            {loading ? '--' : stats.successRate.toFixed(1)}%
          </span>
          <span>Streak: {loading ? '--' : stats.consecutiveSuccesses.toLocaleString()}</span>
        </div>
      </div>

      {/* Tokens */}
      <div className={`${styles.kpiCard} ${styles.green}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.tokens')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>{loading ? '--' : formatNumber(stats.totalTokens)}</div>
        <div className={styles.kpiMeta}>
          <span>
            {t('monitor.kpi.input')}: {loading ? '--' : formatNumber(stats.inputTokens)}
          </span>
          <span>
            {t('monitor.kpi.output')}: {loading ? '--' : formatNumber(stats.outputTokens)}
          </span>
        </div>
      </div>

      {/* 平均 TPM */}
      <div className={`${styles.kpiCard} ${styles.purple}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.avg_tpm')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>{loading ? '--' : formatNumber(stats.avgTpm)}</div>
        <div className={styles.kpiMeta}>
          <span>{t('monitor.kpi.tokens_per_minute')}</span>
        </div>
      </div>

      {/* 平均 RPM */}
      <div className={`${styles.kpiCard} ${styles.orange}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.avg_rpm')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>{loading ? '--' : stats.avgRpm.toFixed(1)}</div>
        <div className={styles.kpiMeta}>
          <span>{t('monitor.kpi.requests_per_minute')}</span>
        </div>
      </div>

      {/* 日均 RPD */}
      <div className={`${styles.kpiCard} ${styles.cyan}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.avg_rpd')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>{loading ? '--' : formatNumber(stats.avgRpd)}</div>
        <div className={styles.kpiMeta}>
          <span>{t('monitor.kpi.requests_per_day')}</span>
        </div>
      </div>

      {/* 总花费 */}
      <div className={`${styles.kpiCard} ${styles.yellow}`}>
        <div className={styles.kpiTitle}>
          <span className={styles.kpiLabel}>{t('monitor.kpi.total_cost')}</span>
          <span className={styles.kpiTag}>{timeRangeLabel}</span>
        </div>
        <div className={styles.kpiValue}>
          {loading
            ? '--'
            : Object.keys(modelPrices).length > 0
              ? `$${stats.totalCost.toFixed(2)}`
              : '--'}
        </div>
        <div className={styles.kpiMeta}>
          <span>
            {Object.keys(modelPrices).length > 0
              ? `${t('monitor.kpi.total_tokens')}: ${formatNumber(stats.totalTokens)}`
              : t('monitor.kpi.cost_need_price')}
          </span>
        </div>
      </div>
    </div>
  );
}
