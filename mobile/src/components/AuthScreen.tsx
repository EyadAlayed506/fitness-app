import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { server } from "@/lib/api";
import { useTheme } from "@/lib/theme";

import { Button, Field, LinkButton, Row, Txt } from "./ui";

export function AuthScreen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingTop: 48, width: "100%", maxWidth: 480, alignSelf: "center" }}
        >
          <View
            style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: t.accent, alignItems: "center", justifyContent: "center", marginBottom: 18 }}
          >
            <Ionicons name="barbell" size={30} color="#fff" />
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Shows which backend the app talks to, and lets the user change it (e.g. the PC's Wi-Fi address). */
export function ServerSetting() {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(server.url);
  const [shown, setShown] = useState(server.url);
  if (!editing) {
    return (
      <Row style={{ justifyContent: "center", marginTop: 28, flexWrap: "wrap" }} gap={6}>
        <Txt variant="tiny">Server: {shown}</Txt>
        <LinkButton title="Change" onPress={() => setEditing(true)} />
      </Row>
    );
  }
  return (
    <View style={{ marginTop: 24 }}>
      <Field label="Server address" value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="http://192.168.1.10:8000" />
      <Txt variant="tiny" style={{ marginTop: 6 }}>
        The computer running the backend. On a phone, use the computer’s Wi-Fi address.
      </Txt>
      <Row style={{ marginTop: 10 }}>
        <Button
          title="Save"
          small
          onPress={async () => {
            await server.set(url);
            setShown(server.url);
            setEditing(false);
          }}
        />
        <Button
          title="Reset"
          small
          kind="ghost"
          onPress={async () => {
            await server.reset();
            setUrl(server.url);
            setShown(server.url);
            setEditing(false);
          }}
        />
      </Row>
    </View>
  );
}
