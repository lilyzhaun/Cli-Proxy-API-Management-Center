import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PwaManager() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [waitingRegistration, setWaitingRegistration] = useState<ServiceWorkerRegistration | null>(
    null
  );
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const updatePromptedRef = useRef(false);
  const installPromptedRef = useRef(false);
  const hasReloadedRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');

        if (registration.waiting) {
          setWaitingRegistration(registration);
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) {
            return;
          }

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingRegistration(registration);
            }
          });
        });
      } catch (error: unknown) {
        console.warn('Service Worker registration failed:', error);
      }
    };

    register();

    const handleControllerChange = () => {
      if (hasReloadedRef.current) {
        return;
      }
      hasReloadedRef.current = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!waitingRegistration || updatePromptedRef.current) {
      return;
    }

    updatePromptedRef.current = true;

    showConfirmation({
      title: t('pwa.update_title'),
      message: t('pwa.update_message'),
      confirmText: t('pwa.update_confirm'),
      cancelText: t('common.cancel'),
      variant: 'primary',
      onConfirm: async () => {
        const waitingWorker = waitingRegistration.waiting;
        if (!waitingWorker) {
          showNotification(t('notification.refresh_failed'), 'warning');
          return;
        }
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        showNotification(t('pwa.update_applying'), 'info');
      },
    });
  }, [showConfirmation, showNotification, t, waitingRegistration]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      event.preventDefault();
      setInstallPromptEvent(installEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (!installPromptEvent || installPromptedRef.current) {
      return;
    }

    installPromptedRef.current = true;
    showConfirmation({
      title: t('pwa.install_title'),
      message: t('pwa.install_message'),
      confirmText: t('pwa.install_confirm'),
      cancelText: t('common.cancel'),
      variant: 'secondary',
      onConfirm: async () => {
        await installPromptEvent.prompt();
        const choice = await installPromptEvent.userChoice;
        if (choice.outcome === 'accepted') {
          showNotification(t('pwa.install_accepted'), 'success');
        } else {
          showNotification(t('pwa.install_dismissed'), 'info');
        }
        setInstallPromptEvent(null);
      },
    });
  }, [installPromptEvent, showConfirmation, showNotification, t]);

  return null;
}
