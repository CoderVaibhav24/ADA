import type { SuperTokensConfig } from "supertokens-auth-react/lib/build/types";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import Session from "supertokens-auth-react/recipe/session";

export const USER_EMAIL_KEY = "ada:user-email";

/**
 * Dark restyle of the SuperTokens prebuilt auth UI so it matches the
 * operations-console theme of the app.
 */
const authStyle = `
  [data-supertokens~=container] {
    --palette-background: 16, 22, 29;
    --palette-inputBackground: 10, 14, 19;
    --palette-inputBorder: 34, 48, 63;
    --palette-textTitle: 219, 230, 240;
    --palette-textLabel: 173, 189, 204;
    --palette-textPrimary: 219, 230, 240;
    --palette-textInput: 219, 230, 240;
    --palette-primary: 255, 122, 41;
    --palette-primaryBorder: 214, 96, 27;
    --palette-error: 255, 92, 92;
    --palette-textLink: 255, 154, 94;
    --palette-superTokensBrandingBackground: 16, 22, 29;
    --palette-superTokensBrandingText: 74, 90, 106;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  }
  [data-supertokens~=headerTitle] {
    font-family: "Barlow Condensed", sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  [data-supertokens~=button] {
    border-radius: 3px;
    font-weight: 600;
  }
  [data-supertokens~=input] {
    border-radius: 3px;
  }
`;

export const superTokensConfig: SuperTokensConfig = {
  appInfo: {
    appName: "PCSMCPL Change Detection",
    apiDomain: window.location.origin,
    websiteDomain: window.location.origin,
    apiBasePath: "/api/auth",
    websiteBasePath: "/auth",
  },
  recipeList: [
    EmailPassword.init({
      style: authStyle,
      onHandleEvent: (context) => {
        // Remember the signed-in email for the header — the backend
        // exposes no /me endpoint, and the access token payload does
        // not carry the email by default.
        if (context.action === "SUCCESS") {
          const email = context.user.emails[0];
          if (email) window.localStorage.setItem(USER_EMAIL_KEY, email);
        }
      },
    }),
    Session.init(),
  ],
};
