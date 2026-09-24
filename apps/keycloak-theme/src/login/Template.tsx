import { useEffect } from "react";

import { getKcClsx } from "keycloakify/login/lib/kcClsx";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import { useSetClassName } from "keycloakify/tools/useSetClassName";

// Same placeholder aerial as apps/web/src/assets/login; swap both together when real imagery lands.
import aerial from "./assets/aerial-map-placeholder.jpg";
import type { KcContext } from "./KcContext";
import type { I18n } from "./i18n";
import { Icon } from "./icons";
import { AccountLine, Notice } from "./parts";

// The ICMS login frame (map, wordmark, glass card, support footer) shared by every hosted page.
export default function Template(props: TemplateProps<KcContext, I18n>) {
  const {
    displayInfo = false,
    displayMessage = true,
    headerNode,
    socialProvidersNode = null,
    infoNode = null,
    documentTitle,
    bodyClassName,
    kcContext,
    i18n,
    doUseDefaultCss,
    classes,
    children,
  } = props;
  const { kcClsx } = getKcClsx({ doUseDefaultCss, classes });
  const { msg, msgStr, enabledLanguages, currentLanguage } = i18n;
  const { auth, url, message, isAppInitiatedAction } = kcContext;

  useEffect(() => {
    document.title = documentTitle ?? `${msgStr("adaBrandShort")}${msgStr("adaBrandRest")}`;
  }, [documentTitle, msgStr]);

  useSetClassName({ qualifiedName: "html", className: `${kcClsx("kcHtmlClass")} ada-html` });
  useSetClassName({
    qualifiedName: "body",
    className: `${bodyClassName ?? kcClsx("kcBodyClass")} ada-body`,
  });

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
  if (!isReadyToRender) return null;

  const showMessage =
    displayMessage &&
    message !== undefined &&
    (message.type !== "warning" || !isAppInitiatedAction);
  const showAccount =
    auth?.showUsername && !auth.showResetCredentials && !!auth.attemptedUsername;

  return (
    <main className="ada-page">
      <img src={aerial} alt="" aria-hidden="true" className="ada-page__bg" />
      <div aria-hidden="true" className="ada-page__wash" />

      <div className="ada-page__column">
        <h1 className="ada-wordmark">
          <span className="ada-wordmark__short">{msg("adaBrandShort")}</span>
          {msg("adaBrandRest")}
        </h1>

        <div className="ada-card">
          {enabledLanguages.length > 1 && (
            <nav className="ada-locale" aria-label={msgStr("languages")}>
              {enabledLanguages.map(({ languageTag, label, href }) => (
                <a
                  key={languageTag}
                  href={href}
                  aria-current={label === currentLanguage.label ? "true" : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
          )}

          <h2 id="kc-page-title" className="ada-title">
            {headerNode}
          </h2>

          <div id="kc-content" className="ada-content">
            <div aria-live="assertive" aria-atomic="true" className="ada-live">
              {showMessage && message && (
                <Notice
                  tone={message.type === "error" ? "error" : "info"}
                  title={message.type === "error" ? msg("adaErrorHeading") : undefined}
                  html={message.summary}
                />
              )}
            </div>

            {showAccount && <AccountLine i18n={i18n} username={auth.attemptedUsername!} />}

            <div className="ada-swap">{children}</div>

            {auth?.showTryAnotherWayLink && (
              <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                <input type="hidden" name="tryAnotherWay" value="on" />
                <button type="submit" id="try-another-way" className="ada-text-button">
                  {msg("doTryAnotherWay")}
                </button>
              </form>
            )}

            {socialProvidersNode}

            {displayInfo && (
              <div id="kc-info" className="ada-info">
                {infoNode}
              </div>
            )}
          </div>

          <footer className="ada-support">
            <div className="ada-support__row">
              <Icon name="phone" className="ada-support__icon" />
              <p className="ada-support__text">
                {msg("adaSupportPrefix")}{" "}
                <a
                  href={`tel:${msgStr("adaSupportNumber").replace(/\D/g, "")}`}
                  aria-label={msgStr("adaSupportLinkLabel")}
                >
                  {msg("adaSupportNumber")}
                </a>
              </p>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
