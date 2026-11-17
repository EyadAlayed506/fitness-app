import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";

import { GymScanFlow, PhotoMatchStatusCard } from "@/components/GymParts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  ListRow,
  Loading,
  Row,
  Section,
  Segmented,
  Sheet,
  SkeletonCards,
  Txt,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { useGyms, useMachinePhotos } from "@/lib/data";
import { shortDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { trOr } from "@/lib/i18n/current";
import { errorMessage, invalidate, qk, useRefreshOnFocus } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { Gym, MachineSetting } from "@/lib/types";

/** Gyms, what the app remembers about each (machine photos and settings), and photographing a gym. */
export default function Gyms() {
  const { ready, token } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  return <GymsScreen />;
}

/** The screen itself, once the login has been restored (so its data loads with it). */
function GymsScreen() {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  const toast = useToast();
  const gyms = useGyms();
  useRefreshOnFocus([qk.gyms, qk.machinePhotos]);
  const [selected, setSelected] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = gyms.data ?? [];
  const gym = list.find((g) => g.id === selected) ?? list.find((g) => g.is_default) ?? list[0] ?? null;

  const run = async (action: () => Promise<unknown>, message?: string) => {
    setError(null);
    try {
      await action();
      invalidate(qk.gyms);
      if (message) toast(message);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {!gyms.data ? (
        <SkeletonCards count={2} />
      ) : (
        <>
          {list.length > 1 ? (
            <Segmented options={list.map((g) => ({ value: String(g.id), label: g.name }))} value={String(gym?.id)} onChange={(v) => setSelected(Number(v))} style={{ marginBottom: space.md }} />
          ) : null}
          {gym ? (
            <Card>
              <Row style={{ justifyContent: "space-between" }} gap={space.sm}>
                <Txt variant="h2" style={{ flex: 1 }} numberOfLines={1}>
                  {gym.name}
                </Txt>
                {gym.is_default ? <Badge label={tr("gym.default")} tone="info" /> : null}
              </Row>
              <Txt variant="small" style={{ marginTop: 2 }}>
                {[tn("gym.workoutCount", gym.workouts), tn("gym.photoCount", gym.photos), tn("gym.settingCount", gym.settings)].join(" · ")}
              </Txt>
              {gym.machines.length || gym.equipment.length ? (
                <Txt variant="tiny" style={{ marginTop: space.xs }}>
                  {tr("gym.fromPhoto", {
                    machines: [tn("gym.machineCount", gym.machines.length), ...gym.equipment.map((e) => trOr(`equip.${e}`, e.replace(/_/g, " ")))].join(tr("list.separator")),
                  })}
                </Txt>
              ) : null}
              {renaming != null ? (
                <Row style={{ alignItems: "flex-end" }}>
                  <Field label={tr("gym.name")} value={renaming} onChangeText={setRenaming} maxLength={80} style={{ flex: 1 }} autoFocus />
                  <Button
                    title={tr("common.save")}
                    onPress={() => run(async () => {
                      await api(`/gyms/${gym.id}`, { method: "PATCH", body: { name: renaming.trim() } });
                      setRenaming(null);
                    }, tr("gym.renamed"))}
                  />
                </Row>
              ) : null}
              <Row style={{ marginTop: space.lg, flexWrap: "wrap" }} gap={space.sm}>
                <Button title={tr("gym.photograph")} icon="camera-outline" small onPress={() => setScanning(true)} />
                <Button title={tr("gym.rename")} kind="soft" small onPress={() => setRenaming(gym.name)} />
                {!gym.is_default ? (
                  <Button title={tr("gym.makeDefault")} kind="soft" small onPress={() => run(() => api(`/gyms/${gym.id}`, { method: "PATCH", body: { is_default: true } }), tr("gym.isDefault", { name: gym.name }))} />
                ) : null}
                {list.length > 1 ? (
                  <Button
                    title={tr("settings.deleteConfirm")}
                    kind="danger"
                    small
                    style={{ borderColor: "transparent" }}
                    onPress={async () => {
                      if (!(await confirm(tr("gym.deleteTitle", { name: gym.name }), tr("gym.deleteText"), tr("settings.deleteConfirm")))) return;
                      await run(async () => {
                        await api(`/gyms/${gym.id}`, { method: "DELETE" });
                        setSelected(null);
                        invalidate(qk.machinePhotos);
                      }, tr("gym.deleted"));
                    }}
                  />
                ) : null}
              </Row>
              <ErrorText message={error} />
            </Card>
          ) : null}

          <Card>
            <Txt variant="label">{tr("gym.add")}</Txt>
            <Row style={{ alignItems: "flex-end" }}>
              <Field value={newName} onChangeText={setNewName} placeholder={tr("gym.addPlaceholder")} maxLength={80} style={{ flex: 1, marginTop: space.xs }} accessibilityLabel={tr("gym.newName")} />
              <Button
                title={tr("food.add")}
                icon="add"
                kind="soft"
                disabled={!newName.trim()}
                onPress={() => run(async () => {
                  const created = await api<Gym>("/gyms", { method: "POST", body: { name: newName.trim() } });
                  setSelected(created.id);
                  setNewName("");
                }, tr("gym.added"))}
              />
            </Row>
          </Card>

          {gym ? <MachineSettingsList gym={gym} /> : null}
          {gym ? <SavedPhotos gym={gym} /> : null}
        </>
      )}

      <Sheet visible={scanning && !!gym} title={gym ? tr("gym.photographTitle", { name: gym.name }) : ""} onClose={() => setScanning(false)}>
        {scanning && gym ? (
          <GymScanFlow
            gym={gym}
            onStart={() => {
              setScanning(false);
              toast(tr("gym.savedStart"));
            }}
          />
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

function MachineSettingsList({ gym }: { gym: Gym }) {
  const { t: tr } = useI18n();
  const settings = useQuery({
    queryKey: ["gyms", "machines", gym.id],
    queryFn: () => api<MachineSetting[]>(`/gyms/${gym.id}/machines`),
  });
  return (
    <>
      <Section title={tr("gym.settings")} />
      <Card style={{ paddingVertical: settings.data?.length ? space.xs : space.lg }}>
        {settings.data?.length ? (
          settings.data.map((s, i) => (
            <ListRow
              key={s.exercise_id}
              first={i === 0}
              title={s.exercise_name}
              subtitle={[
                s.seat && tr("setting.value", { label: tr("setting.seat"), value: s.seat }),
                s.pins && tr("setting.value", { label: tr("setting.pins"), value: s.pins }),
                s.back_pad && tr("setting.value", { label: tr("setting.back_pad"), value: s.back_pad }),
                s.handle && tr("setting.value", { label: tr("setting.handle"), value: s.handle }),
                s.notes,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))
        ) : (
          <EmptyState icon="options-outline" title={tr("gym.noSettingsTitle")} text={tr("gym.noSettingsText")} />
        )}
      </Card>
    </>
  );
}

function SavedPhotos({ gym }: { gym: Gym }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const photos = useMachinePhotos();
  const mine = (photos.data ?? []).filter((p) => p.gym_id === gym.id);
  return (
    <>
      <Section title={tr("gym.photos")} />
      <Txt variant="small" style={{ marginTop: -space.xs, marginBottom: space.sm }}>
        {tr("gym.photosIntro")}
      </Txt>
      <PhotoMatchStatusCard />
      <Card>
        {mine.length ? (
          <View style={styles.grid}>
            {mine.map((p) => (
              <View key={p.id} style={[styles.tile, { backgroundColor: t.surface2 }]}>
                <Image source={{ uri: p.thumbnail }} style={styles.thumb} accessibilityLabel={tr("gym.photoOf", { name: p.exercise_name })} />
                <View style={{ padding: space.sm }}>
                  <Txt variant="label" numberOfLines={2} style={{ color: t.text }}>
                    {p.exercise_name}
                  </Txt>
                  <Txt variant="tiny">
                    {shortDate(p.created_at.slice(0, 10))}
                    {p.corrected ? tr("gym.corrected") : ""}
                    {p.matchable ? "" : tr("gym.waitingModel")}
                  </Txt>
                </View>
                <View style={styles.remove}>
                  <IconButton
                    icon="trash-outline"
                    label={tr("gym.deletePhoto", { name: p.exercise_name })}
                    onPress={async () => {
                      try {
                        await api(`/photo-memory/photos/${p.id}`, { method: "DELETE" });
                        invalidate(qk.machinePhotos, qk.gyms);
                        toast(tr("gym.photoDeleted"));
                      } catch (e) {
                        toast(errorMessage(e) ?? tr("gym.couldntDelete"));
                      }
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState icon="images-outline" title={tr("gym.noPhotosTitle")} text={tr("gym.noPhotosText")} />
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, paddingBottom: space.xxl, width: "100%", maxWidth: 600, alignSelf: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: { width: "48%", flexGrow: 1, maxWidth: 260, borderRadius: radius.md, overflow: "hidden" },
  thumb: { width: "100%", aspectRatio: 4 / 3 },
  remove: { position: "absolute", top: space.xs, end: space.xs },
});
