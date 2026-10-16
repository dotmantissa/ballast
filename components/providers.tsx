"use client";
import { useSyncExternalStore } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "light" as const,
  );
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId)
    return (
      <div className="setup-error">
        Ballast needs its email sign in configuration. Add the public Privy app
        ID to the server environment.
      </div>
    );
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        externalWallets: {
          disableAllExternalWallets: true,
          walletConnect: { enabled: false },
        },
        appearance: {
          theme,
          accentColor: "#cc904a",
          logo: "/icon.svg",
          showWalletLoginFirst: false,
        },
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
        legal: {
          termsAndConditionsUrl: "/terms",
          privacyPolicyUrl: "/privacy",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
