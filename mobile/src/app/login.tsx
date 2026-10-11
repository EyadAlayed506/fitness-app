import { Redirect, router } from "expo-router";
import { useState } from "react";

import { AuthScreen, ServerSetting } from "@/components/AuthScreen";
import { Button, ErrorText, Field, LinkButton, Row, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";

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
      <Txt variant="h2" style={{ fontSize: 28 }}>
        Welcome back
      </Txt>
      <Txt variant="muted" style={{ marginTop: 4 }}>
        Log in to see your plan, workouts and food log.
      </Txt>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button title="Log in" onPress={submit} style={{ marginTop: 16 }} />
      <Row style={{ justifyContent: "center", marginTop: 16 }} gap={6}>
        <Txt variant="muted">New here?</Txt>
        <LinkButton title="Create an account" onPress={() => router.push("/signup")} />
      </Row>
      <ServerSetting />
    </AuthScreen>
  );
}
