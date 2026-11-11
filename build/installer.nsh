; Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
; Runs only after a real interactive uninstall. App updates pass isUpdated and
; silent uninstallers must never remove user data.

LangString pulplogDeleteDataPrompt 3082 "¿También quieres eliminar todos los datos locales de PulpLog? Esto borra la bóveda de contraseñas, conversaciones, ajustes y logs internos. No elimina los archivos de log originales que abriste. La acción no se puede deshacer."
LangString pulplogDeleteDataPrompt 1033 "Also delete all local PulpLog data? This removes the password vault, conversations, settings, and internal logs. It does not delete original log files you opened. This cannot be undone."

!macro customUnInstallSection
  Section "Remove PulpLog user data"
    ${ifNot} ${isUpdated}
      IfSilent pulplog_keep_data
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "$(pulplogDeleteDataPrompt)" IDNO pulplog_keep_data
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
      pulplog_keep_data:
    ${endif}
  SectionEnd
!macroend
