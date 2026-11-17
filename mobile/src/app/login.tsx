import { Redirect, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AuthScreen, ServerSetting } from "@/components/AuthScreen";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Button, ErrorText, Field, Icon, LinkButton, Row, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";

export default function Login() {
  const { token, expired, login } = useAuth();
  const theme = useTheme();
  const { t, errorText } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  if (token) return <Redirect href="/" />;

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("missing");
      return;
    }
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (e) {
      setError(e);
    }
  };

  // The error is kept as-is and translated when shown, so switching language also switches the message
  const message = error === null ? null : error === "missing" ? t("login.missingFields") : errorText(error);

  return (
    <AuthScreen top={<LanguageSwitch />}>
      <Txt variant="h2" style={{ ...typeScale.title, fontSize: 28, lineHeight: 34 }}>
        {t("login.title")}
      </Txt>
      <Txt variant="small" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {t("login.subtitle")}
      </Txt>
      {expired ? (
        // after an expired login: say why, and that nothing logged was lost (sets are saved as they're logged)
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.sm,
            padding: space.md,
            marginBottom: space.md,
            borderRadius: radius.md,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Icon name="time-outline" size={18} color={theme.text} style={{ marginTop: 1 }} />
          <Txt variant="small" style={{ flex: 1, color: theme.text }}>
            {t("login.sessionExpired")}
          </Txt>
        </View>
      ) : null}
      <Field label={t("login.email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label={t("login.password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
      <ErrorText message={message} />
      <Button title={t("login.submit")} onPress={submit} style={{ marginTop: space.xl }} />
      <Row style={{ justifyContent: "center", marginTop: space.lg }} gap={6}>
        <Txt variant="small">{t("login.newHere")}</Txt>
        <LinkButton title={t("login.createAccount")} onPress={() => router.push("/signup")} />
      </Row>
      <ServerSetting />
    </AuthScreen>
  );
}
