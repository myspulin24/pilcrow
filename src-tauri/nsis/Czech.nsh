; Czech strings for the Tauri parts of the NSIS installer.
;
; NSIS ships its own Czech translation for the standard wizard pages, but the
; prompts Tauri adds on top (WebView2, upgrade/downgrade, "the app is running")
; have no Czech translation upstream, so they are provided here. The key list
; is exactly the one the generated installer.nsi and utils.nsh reference.

LangString addOrReinstall ${LANG_CZECH} "Přidat nebo přeinstalovat součásti"
LangString alreadyInstalled ${LANG_CZECH} "Už je nainstalováno"
LangString alreadyInstalledLong ${LANG_CZECH} "${PRODUCTNAME} ${VERSION} už je nainstalovaný. Vyber, co chceš udělat, a pokračuj tlačítkem Další."
LangString appRunning ${LANG_CZECH} "${PRODUCTNAME} právě běží!$\nZavři ho a spusť instalaci znovu."
LangString appRunningOkKill ${LANG_CZECH} "${PRODUCTNAME} právě běží!$\nKlikni na OK a ukončí se."
LangString chooseMaintenanceOption ${LANG_CZECH} "Vyber, co se má udělat"
LangString choowHowToInstall ${LANG_CZECH} "Vyber, jak chceš ${PRODUCTNAME} nainstalovat."
LangString createDesktop ${LANG_CZECH} "Vytvořit zástupce na ploše"
LangString deleteAppData ${LANG_CZECH} "Smazat i data aplikace"
LangString dontUninstall ${LANG_CZECH} "Neodinstalovávat"
LangString dontUninstallDowngrade ${LANG_CZECH} "Neodinstalovávat (návrat na starší verzi bez odinstalace není podporovaný)"
LangString failedToKillApp ${LANG_CZECH} "${PRODUCTNAME} se nepodařilo ukončit. Zavři ho ručně a zkus to znovu."
LangString installingWebview2 ${LANG_CZECH} "Instaluji WebView2..."
LangString newerVersionInstalled ${LANG_CZECH} "Už je nainstalovaná novější verze ${PRODUCTNAME}! Návrat na starší verzi se nedoporučuje. Pokud chceš verzi ${VERSION} opravdu nainstalovat, odinstaluj nejdřív tu současnou."
LangString older ${LANG_CZECH} "starší"
LangString olderOrUnknownVersionInstalled ${LANG_CZECH} "Na počítači je $R4 verze ${PRODUCTNAME}. Před instalací verze ${VERSION} ji doporučujeme odinstalovat. Vyber, co se má udělat, a pokračuj."
LangString silentDowngrades ${LANG_CZECH} "Návrat na starší verzi při tiché instalaci není podporovaný, protože aplikace může být nainstalovaná pro jiného uživatele. Spusť instalátor znovu bez přepínače /S."
LangString unableToUninstall ${LANG_CZECH} "Odinstalace se nezdařila!"
LangString uninstallApp ${LANG_CZECH} "Odinstalovat ${PRODUCTNAME}"
LangString uninstallBeforeInstalling ${LANG_CZECH} "Před instalací odinstalovat"
LangString unknown ${LANG_CZECH} "neznámá"
LangString webview2AbortError ${LANG_CZECH} "WebView2 se nepodařilo nainstalovat! Bez něj aplikace nepoběží. Zkus instalátor spustit znovu."
LangString webview2DownloadError ${LANG_CZECH} "Chyba: stažení WebView2 se nezdařilo - $0"
LangString webview2DownloadSuccess ${LANG_CZECH} "Zavaděč WebView2 se stáhl v pořádku"
LangString webview2Downloading ${LANG_CZECH} "Stahuji zavaděč WebView2..."
LangString webview2InstallError ${LANG_CZECH} "Chyba: instalace WebView2 skončila s kódem $1"
LangString webview2InstallSuccess ${LANG_CZECH} "WebView2 nainstalován v pořádku"
