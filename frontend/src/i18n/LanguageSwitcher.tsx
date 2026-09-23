import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/lib/icons";
import { LANGUAGES, useLanguage, type Language } from "./index";

/**
 * The language control in the top bar.
 *
 * A radio group rather than a toggle: a two-language toggle has no way to say
 * which language it is currently IN, only which one it would switch to, and the
 * two read identically to anyone who cannot read one of them.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          aria-label={t("language.switchTo")}
        >
          <Icon name="user.language" className="size-4 shrink-0" />
          {/* The short tag, not the full name: at 360px the account pill is
              already competing for the same strip. */}
          <span className="hidden text-2xs font-medium tracking-wide uppercase sm:inline">
            {language === "hi-IN" ? "हिं" : "EN"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => {
            setLanguage(value as Language);
          }}
        >
          {LANGUAGES.map((code) => (
            // lang= so a screen reader pronounces each option in its own voice,
            // which is the whole point of offering the choice here.
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {t(`language.${code}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
