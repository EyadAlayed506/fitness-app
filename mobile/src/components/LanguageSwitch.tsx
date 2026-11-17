import { View, type StyleProp, type ViewStyle } from "react-native";

import { LANGUAGES } from "@/lib/i18n/core";
import { useI18n, type Language } from "@/lib/i18n";

import { Segmented } from "./ui";

/**
 * English | العربية. Each language is written in its own script, so a user who can't read the
 * current language can still find theirs. Changes the whole app at once and is remembered.
 */
export function LanguageSwitch({ style }: { style?: StyleProp<ViewStyle> }) {
  const { lang, t, setLanguage } = useI18n();
  return (
    <View style={[{ width: 200, alignSelf: "flex-end" }, style]} accessibilityLabel={t("language.label")}>
      <Segmented<Language>
        options={LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
        value={lang}
        onChange={setLanguage}
      />
    </View>
  );
}
