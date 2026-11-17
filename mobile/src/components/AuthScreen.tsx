import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { server } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { radius, space, useTheme } from "@/lib/theme";

import { Button, Field, LinkButton, Row, Txt } from "./ui";

/** `top` sits at the end of the logo row (e.g. the language switch). */
export function AuthScreen({ children, top }: { children: ReactNode; top?: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: 56, paddingBottom: space.xxl, width: "100%", maxWidth: 440, alignSelf: "center" }}
        >
          <Row style={{ justifyContent: "space-between", marginBottom: space.xl }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md + 2, backgroundColor: t.ink, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="barbell" size={24} color={t.inkText} />
            </View>
            {top}
          </Row>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Shows which backend the app talks to, and lets the user change it (e.g. the PC's Wi-Fi address). */
export function ServerSetting() {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(server.url);
  const [shown, setShown] = useState(server.url);
  if (!editing) {
    return (
      <Row style={{ justifyContent: "center", marginTop: space.xxl, flexWrap: "wrap" }} gap={6}>
        <Txt variant="tiny">{t("server.current", { url: shown })}</Txt>
        <LinkButton title={t("server.change")}onPress={() => setEditing(true)} />
      </Row>
    );
  }
  return (
    <View style={{ marginTop: 24 }}>
      <Field label={t("server.address")} value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="http://192.168.1.10:8000" />
      <Txt variant="tiny" style={{ marginTop: 6 }}>
        {t("server.hint")}
      </Txt>
      <Row style={{ marginTop: 10 }}>
        <Button
          title={t("server.save")}
          small
          onPress={async () => {
            await server.set(url);
            setShown(server.url);
            setEditing(false);
          }}
        />
        <Button
          title={t("server.reset")}
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
