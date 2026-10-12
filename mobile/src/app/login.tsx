import { Redirect, router } from "expo-router";
import { useState } from "react";

import { AuthScreen, ServerSetting } from "@/components/AuthScreen";
import { Button, ErrorText, Field, LinkButton, Row, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { space, type as typeScale } from "@/lib/theme";

export default function Login() {
  const { token, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (token) return <Redirect href="/" />;

  const submit = async () => {
    setError(null);
    try {
      await login(email, password);
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <AuthScreen>
      <Txt variant="h2" style={{ ...typeScale.title, fontSize: 28, lineHeight: 34 }}>
        Welcome back
      </Txt>
      <Txt variant="small" style={{ marginTop: space.xs, marginBottom: space.md }}>
        Log in to see your plan, workouts and food log.
      </Txt>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button title="Log in" onPress={submit} style={{ marginTop: space.xl }} />
      <Row style={{ justifyContent: "center", marginTop: space.lg }} gap={6}>
        <Txt variant="small">New here?</Txt>
        <LinkButton title="Create an account" onPress={() => router.push("/signup")} />
      </Row>
      <ServerSetting />
    </AuthScreen>
  );
}
