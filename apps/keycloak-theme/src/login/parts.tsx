import { useState, type InputHTMLAttributes, type ReactNode } from "react";

import { kcSanitize } from "keycloakify/lib/kcSanitize";

import type { I18n } from "./i18n";
import { Icon } from "./icons";

// Red-tinted box used for "Sign-in problem" on the web login; tone "info" is its calm twin.
export function Notice(props: {
  tone: "error" | "info";
  title?: ReactNode;
  children?: ReactNode;
  html?: string;
}) {
  const { tone, title, children, html } = props;
  if (tone === "info" && !title) {
    return (
      <p className="ada-notice ada-notice--info" role="status">
        <Icon name="info" className="ada-notice__icon" />
        {html !== undefined ? (
          <span dangerouslySetInnerHTML={{ __html: kcSanitize(html) }} />
        ) : (
          <span>{children}</span>
        )}
      </p>
    );
  }
  return (
    <div className={`ada-notice ada-notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <p className="ada-notice__title">
        <Icon name={tone === "error" ? "error" : "info"} className="ada-notice__icon" />
        <span>{title}</span>
      </p>
      {html !== undefined ? (
        <p className="ada-notice__body" dangerouslySetInnerHTML={{ __html: kcSanitize(html) }} />
      ) : (
        children && <p className="ada-notice__body">{children}</p>
      )}
    </div>
  );
}

// One labelled input well, matching the web login's field block.
export function Field(props: {
  id: string;
  label: ReactNode;
  error?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="ada-field">
      <label htmlFor={props.id} className={`ada-label ${props.labelClassName ?? ""}`}>
        {props.label}
      </label>
      {props.children}
      {props.error && (
        <span
          id={`input-error-${props.id}`}
          className="ada-field-error"
          aria-live="polite"
          dangerouslySetInnerHTML={{ __html: kcSanitize(props.error) }}
        />
      )}
    </div>
  );
}

// Password well with the reveal-eye button placed exactly as on the web login.
export function PasswordInput(
  props: InputHTMLAttributes<HTMLInputElement> & { id: string; i18n: I18n },
) {
  const { i18n, className, ...rest } = props;
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="ada-password">
      <input
        {...rest}
        type={revealed ? "text" : "password"}
        className={`ada-input ada-input--with-reveal ${className ?? ""}`}
      />
      <button
        type="button"
        className="ada-reveal"
        aria-label={i18n.msgStr(revealed ? "hidePassword" : "showPassword")}
        aria-pressed={revealed}
        aria-controls={rest.id}
        onClick={() => setRevealed((on) => !on)}
      >
        <Icon name={revealed ? "eyeOff" : "eye"} className="ada-reveal__icon" />
      </button>
    </div>
  );
}

// The wide ochre pill with the forward arrow, or a spinner while the form posts.
export function SubmitButton(props: {
  label: string;
  busy?: boolean;
  id?: string;
  name?: string;
}) {
  return (
    <div className="ada-submit-row">
      <button
        type="submit"
        id={props.id}
        name={props.name}
        disabled={props.busy}
        className="ada-submit"
      >
        <span className="ada-submit__label">{props.label}</span>
        <Icon
          name={props.busy ? "loader" : "arrowRight"}
          className={`ada-submit__icon ${props.busy ? "ada-spin" : ""}`}
        />
      </button>
    </div>
  );
}

// The uppercase ochre text link with a back arrow used for "Back to password" on the web.
export function BackLink(props: { href: string; children: ReactNode }) {
  return (
    <a href={props.href} className="ada-back">
      <Icon name="arrowLeft" className="ada-back__icon" />
      {props.children}
    </a>
  );
}

// "Signing in as <name>" line shown above a step that already knows the account.
export function AccountLine(props: { i18n: I18n; username: string }) {
  return (
    <p className="ada-account">
      <Icon name="user" className="ada-account__icon" />
      <span className="ada-account__text">
        {props.i18n.msg("adaSigningInAs")} <strong>{props.username}</strong>
      </span>
    </p>
  );
}
