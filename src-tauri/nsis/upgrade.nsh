; Odstranění předchozí instalace pod starým názvem.
;
; Aplikace se dřív jmenovala Reader_MJ. Instalátor NSIS pozná předchozí verzi
; podle klíče v registru odvozeného z názvu produktu
; (`Uninstall\${PRODUCTNAME}`), takže po přejmenování by Pilcrow starou
; instalaci prostě neviděl: nainstaloval by se vedle ní a v Programech
; a funkcích by zůstaly dvě položky, dvě zkratky v nabídce Start a dvě kopie
; aplikace na disku. Aktualizace by tím přestala být aktualizací.
;
; Tenhle háček se pouští těsně před kopírováním souborů: najde starou
; instalaci, ukončí ji, pokud běží, a tiše spustí její odinstalátor.
;
; Poznámky uživatele to nijak neohrozí -- ty jsou ve složce Dokumenty, ne
; v instalační složce, a odinstalátor Reader_MJ na ně nesahá.
;
; Až bude jisté, že nikde nezůstala instalace staršího názvu, může tenhle
; soubor i odkaz na něj v `tauri.conf.json` zmizet.

!define OLD_PRODUCTNAME "Reader_MJ"
!define OLD_BUNDLEID "com.readermj.app"
!define OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLD_PRODUCTNAME}"

!macro NSIS_HOOK_PREINSTALL
  ; $R4 přežije celý blok; $R0..$R3 si bere CheckIfAppIsRunning.
  Push $R4
  Push $R5

  ; Stará verze se instalovala jen pro přihlášeného uživatele, ale koukneme
  ; i do HKLM -- kdyby ji tam někdy nechal instalátor MSI.
  ReadRegStr $R4 HKCU "${OLD_UNINSTKEY}" "UninstallString"
  StrCmp $R4 "" 0 found_hkcu
    ReadRegStr $R4 HKLM "${OLD_UNINSTKEY}" "UninstallString"
    StrCmp $R4 "" nothing_to_do 0
    ReadRegStr $R5 HKLM "${OLD_UNINSTKEY}" "InstallLocation"
    Goto uninstall_old
  found_hkcu:
    ReadRegStr $R5 HKCU "${OLD_UNINSTKEY}" "InstallLocation"

  uninstall_old:
    DetailPrint "Odstraňuji předchozí verzi (${OLD_PRODUCTNAME})..."

    ; Obě hodnoty jsou v registru uložené i s uvozovkami (`"C:\...\uninstall.exe"`).
    ; Argument `_?=` uvozovky nesnese -- s nimi se odinstalátor ani nespustí
    ; a po staré aplikaci zůstane složka i zkratka v nabídce Start. Stálo to
    ; jeden neúspěšný pokus, tak ať je to tady napsané.
    nsis_tauri_utils::StrReplace "$R4" "$\"" ""
    Pop $R4
    nsis_tauri_utils::StrReplace "$R5" "$\"" ""
    Pop $R5

    ; Běžící stará aplikace by držela svoje soubory a odinstalace by selhala.
    ; Aktualizace ji sice zavírá sama, ale ruční instalace ne.
    nsis_tauri_utils::FindProcessCurrentUser "${OLD_PRODUCTNAME}.exe"
    Pop $R0
    ${If} $R0 = 0
      nsis_tauri_utils::KillProcessCurrentUser "${OLD_PRODUCTNAME}.exe"
      Pop $R0
      Sleep 1000
    ${EndIf}

    ; `_?=` je podstatné: bez něj se odinstalátor zkopíruje do dočasné složky
    ; a vrátí se hned, takže bychom začali instalovat do adresáře, který se
    ; teprve maže. S ním se počká na konec -- ale odinstalátor po sobě neuklidí
    ; sám, takže zbytek doklidíme my.
    ${If} $R5 != ""
      ; `_?=` musí zůstat úplně poslední -- zbytek příkazu se bere jako cesta,
      ; takže tak projde i složka s mezerou v názvu.
      ExecWait '"$R4" /S _?=$R5' $R0
      ; Odinstalátor se s `_?=` nesmaže sám a nechá po sobě prázdnou složku.
      ; `/r` je tu i pro případ, že by odinstalace selhala a něco zbylo.
      Delete "$R5\uninstall.exe"
      RMDir /r "$R5"
    ${Else}
      ; Bez známé složky se nedá počkat; aspoň se odinstalace spustí.
      ExecWait '"$R4" /S' $R0
    ${EndIf}

    ; Klíče v registru, které by po neúplné odinstalaci zůstaly viset
    ; v Programech a funkcích jako položka bez souborů.
    DeleteRegKey HKCU "${OLD_UNINSTKEY}"
    DeleteRegKey HKLM "${OLD_UNINSTKEY}"

    ; Maže se jen podklíč se starým názvem, ne celá složka výrobce -- tu už
    ; používá Pilcrow. `readermj` je výrobce z verzí do 0.3.1, kdy se odvozoval
    ; z identifikátoru aplikace.
    DeleteRegKey HKCU "Software\${MANUFACTURER}\${OLD_PRODUCTNAME}"
    DeleteRegKey HKCU "Software\readermj"

    ; Data staré aplikace. Odinstalátor je smaže jen tehdy, když si to uživatel
    ; zaškrtne v dialogu -- a v tichém režimu se nikdo neptá, takže by tu po
    ; aktualizaci zůstala mezipaměť WebView2 pod starým identifikátorem.
    ; Poznámky v tom nejsou, ty leží v Dokumentech.
    SetShellVarContext current
    RMDir /r "$APPDATA\${OLD_BUNDLEID}"
    RMDir /r "$LOCALAPPDATA\${OLD_BUNDLEID}"
    ; Výchozí instalační složka, kdyby `InstallLocation` v registru chyběla.
    RMDir /r "$LOCALAPPDATA\${OLD_PRODUCTNAME}"

    ; Zkratky. Odinstalátor je maže sám, ale jen když doběhne; tohle je
    ; pojistka, aby v nabídce Start nezůstal odkaz do prázdna.
    Delete "$SMPROGRAMS\${OLD_PRODUCTNAME}.lnk"
    RMDir /r "$SMPROGRAMS\${OLD_PRODUCTNAME}"
    Delete "$DESKTOP\${OLD_PRODUCTNAME}.lnk"

  nothing_to_do:
  Pop $R5
  Pop $R4
!macroend
