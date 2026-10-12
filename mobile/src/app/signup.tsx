import { Redirect, router } from "expo-router";
import { useState } from "react";

import { AuthScreen, ServerSetting } from "@/components/AuthScreen";
import { Button, Checkbox, ErrorText, Field, LinkButton, Row, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { space, type as typeScale } from "@/lib/theme";

export default function Signup() {
  const { token, signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (token) return <Redirect href="/" />;

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError("The password needs at least 8 characters.");
      return;
    }
    try {
      await signup(email, password, marketing);
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <AuthScreen>
      <Txt variant="h2" style={{ ...typeScale.title, fontSize: 28, lineHeight: 34 }}>
        Create your account
      </Txt>
      <Txt variant="small" style={{ marginTop: space.xs, marginBottom: space.md }}>
        Get your BMI, daily calories and a workout plan in a minute.
      </Txt>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password (at least 8 characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <Checkbox checked={marketing} onChange={setMarketing} label="Email me ads and discounts. You can unsubscribe at any time." />
      <ErrorText message={error} />
      <Button title="Sign up" onPress={submit} style={{ marginTop: space.xl }} />
      <Row style={{ justifyContent: "center", marginTop: space.lg }} gap={6}>
        <Txt variant="small">Already have an account?</Txt>
        <LinkButton title="Log in" onPress={() => router.replace("/login")} />
      </Row>
      <ServerSetting />
    </AuthScreen>
  );
}
