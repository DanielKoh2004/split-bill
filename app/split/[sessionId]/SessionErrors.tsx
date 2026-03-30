"use client";

import { useAppContext } from "@/src/ThemeContext";

export function SessionExpired() {
  const { t } = useAppContext();
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-themed px-5 text-center">
      <h1 className="text-2xl font-bold text-primary-themed">{t.sessionExpired}</h1>
      <p className="text-sm text-secondary-themed mt-2">
        {t.sessionExpiredDesc}
      </p>
    </div>
  );
}

export function InvalidSessionData() {
  const { t } = useAppContext();
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-themed px-5 text-center">
      <h1 className="text-2xl font-bold text-primary-themed">{t.invalidSessionData}</h1>
      <p className="text-sm text-secondary-themed mt-2">
        {t.invalidSessionDataDesc}
      </p>
    </div>
  );
}
