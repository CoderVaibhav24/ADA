import type { ExtendKcContext } from "keycloakify/login";

export type KcContextExtension = {
};

export type KcContextExtensionPerPage = {};

export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>;
