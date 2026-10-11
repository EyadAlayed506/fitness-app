import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";

import { Loading, Txt } from "@/components/ui";
import { api, qrImageUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import type { Exercise } from "@/lib/types";

/** A QR code for every machine, to print and stick on it. */
export default function QrStickers() {
  const t = useTheme();
  const { ready, token } = useAuth();
  const [list, setList] = useState<Exercise[]>([]);
  useEffect(() => {
    if (token) api<Exercise[]>("/exercises?limit=100").then(setList).catch(() => {});
  }, [token]);
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      <Txt variant="small" style={{ marginBottom: 12 }}>
        Scanning a sticker in the app opens that machine. The text under each code can also be typed in. To print them, open
        this page in a browser on your computer.
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {list.map((x) => (
          <View key={x.id} style={{ width: 150, backgroundColor: "#fff", borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: t.border }}>
            <Image source={{ uri: qrImageUrl(x.id) }} style={{ width: 128, height: 128 }} accessibilityLabel={`QR code for ${x.name}`} />
            <Text style={{ color: "#111", fontWeight: "600", fontSize: 12, textAlign: "center" }}>{x.name}</Text>
            <Text style={{ color: "#444", fontSize: 11 }}>{x.qr_code}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
