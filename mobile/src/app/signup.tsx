import { Redirect, router } from "expo-router";
import { useState } from "react";

import { AuthScreen, ServerSetting } from "@/components/AuthScreen";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Button, Checkbox, ErrorText, Field, LinkButton, Row, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { space, type as typeScale } from "@/lib/theme";

export default function Signup() {
  const { token, signup } = useAuth();
  const { t, errorText } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (token) return <Redirect href="/" />;

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError("short");
      return;
    }
    try {
      await signup(email.trim(), password, marketing);
      router.replace("/");
    } catch (e) {
      setError(e);
    }
  };

  // The error is kept as-is and translated when shown, so switching language also switches the message
  const message = error === null ? null : error === "short" ? t("signup.passwordShort") : errorText(error);

  return (
    <AuthScreen top={<LanguageSwitch />}>
      <Txt variant="h2" style={{ ...typeScale.title, fontSize: 28, lineHeight: 34 }}>
        {t("signup.title")}
      </Txt>
      <Txt variant="small" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {t("signup.subtitle")}
      </Txt>
      <Field label={t("login.email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label={t("signup.password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <Checkbox checked={marketing} onChange={setMarketing} label={t("signup.marketing")} />
      <ErrorText message={message} />
      <Button title={t("signup.submit")} onPress={submit} style={{ marginTop: space.xl }} />
      <Row style={{ justifyContent: "center", marginTop: space.lg }} gap={6}>
        <Txt variant="small">{t("signup.haveAccount")}</Txt>
        <LinkButton title={t("login.submit")} onPress={() => router.replace("/login")} />
      </Row>
      <ServerSetting />
    </AuthScreen>
  );
}
