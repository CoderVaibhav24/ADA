import { lazy, Suspense, type ReactNode } from "react";

export type ThemeName = "ada";

export const themeNames: ThemeName[] = ["ada"];

export type KcEnvName = never;

export const kcEnvNames: KcEnvName[] = [];

export const kcEnvDefaults: Record<KcEnvName, string> = {};

export type KcContext =
    | import("./login/KcContext").KcContext
    ;

declare global {
    interface Window {
        kcContext?: KcContext;
    }
}

export const KcLoginPage = lazy(() => import("./login/KcPage"));

export function KcPage(
    props: {
        kcContext: KcContext;
        fallback?: ReactNode;
    }
) {
    const { kcContext, fallback } = props;
    return (
        <Suspense fallback={fallback}>
            {(() => {
                switch (kcContext.themeType) {
                    case "login": return <KcLoginPage kcContext={kcContext} />;
                }
            })()}
        </Suspense>
    );
}

export const BASE_URL = import.meta.env.BASE_URL
