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
                {gym.is_default ? <Badge label="Default" tone="info" /> : null}
              </Row>
              <Txt variant="small" style={{ marginTop: 2 }}>
                {gym.workouts} {gym.workouts === 1 ? "workout" : "workouts"} · {gym.photos} machine {gym.photos === 1 ? "photo" : "photos"} · {gym.settings} machine {gym.settings === 1 ? "setting" : "settings"}
              </Txt>
              {gym.machines.length || gym.equipment.length ? (
                <Txt variant="tiny" style={{ marginTop: space.xs }}>
                  From its photo: {gym.machines.length} {gym.machines.length === 1 ? "machine" : "machines"}
                  {gym.equipment.length ? `, ${gym.equipment.map((e) => e.replace(/_/g, " ")).join(", ")}` : ""}
                </Txt>
              ) : null}
              {renaming != null ? (
                <Row style={{ alignItems: "flex-end" }}>
                  <Field label="Name" value={renaming} onChangeText={setRenaming} maxLength={80} style={{ flex: 1 }} autoFocus />
                  <Button
                    title="Save"
                    onPress={() => run(async () => {
                      await api(`/gyms/${gym.id}`, { method: "PATCH", body: { name: renaming.trim() } });
                      setRenaming(null);
                    }, "Gym renamed")}
                  />
                </Row>
              ) : null}
              <Row style={{ marginTop: space.lg, flexWrap: "wrap" }} gap={space.sm}>
                <Button title="Photograph it" icon="camera-outline" small onPress={() => setScanning(true)} />
                <Button title="Rename" kind="soft" small onPress={() => setRenaming(gym.name)} />
                {!gym.is_default ? (
                  <Button title="Make default" kind="soft" small onPress={() => run(() => api(`/gyms/${gym.id}`, { method: "PATCH", body: { is_default: true } }), `${gym.name} is your default gym`)} />
                ) : null}
                {list.length > 1 ? (
                  <Button
                    title="Delete"
                    kind="danger"
                    small
                    style={{ borderColor: "transparent" }}
                    onPress={async () => {
                      if (!(await confirm(`Delete ${gym.name}?`, "Its machine photos and settings are deleted. Workouts done there stay.", "Delete"))) return;
                      await run(async () => {
                        await api(`/gyms/${gym.id}`, { method: "DELETE" });
                        setSelected(null);
                        invalidate(qk.machinePhotos);
                      }, "Gym deleted");
                    }}
                  />
                ) : null}
              </Row>
              <ErrorText message={error} />
            </Card>
          ) : null}

          <Card>
            <Txt variant="label">Add a gym</Txt>
            <Row style={{ alignItems: "flex-end" }}>
              <Field value={newName} onChangeText={setNewName} placeholder="e.g. Hotel gym" maxLength={80} style={{ flex: 1, marginTop: space.xs }} accessibilityLabel="New gym name" />
              <Button
                title="Add"
                icon="add"
                kind="soft"
                disabled={!newName.trim()}
                onPress={() => run(async () => {
                  const created = await api<Gym>("/gyms", { method: "POST", body: { name: newName.trim() } });
                  setSelected(created.id);
                  setNewName("");
                }, "Gym added")}
              />
            </Row>
          </Card>

          {gym ? <MachineSettingsList gym={gym} /> : null}
          {gym ? <SavedPhotos gym={gym} /> : null}
        </>
      )}

      <Sheet visible={scanning && !!gym} title={gym ? `Photograph ${gym.name}` : ""} onClose={() => setScanning(false)}>
        {scanning && gym ? (
          <GymScanFlow
            gym={gym}
            onStart={() => {
              setScanning(false);
              toast("Saved. Start the session from Workouts → At another gym");
            }}
          />
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

function MachineSettingsList({ gym }: { gym: Gym }) {
  const settings = useQuery({
    queryKey: ["gyms", "machines", gym.id],
    queryFn: () => api<MachineSetting[]>(`/gyms/${gym.id}/machines`),
  });
  return (
    <>
      <Section title="Machine settings" />
      <Card style={{ paddingVertical: settings.data?.length ? space.xs : space.lg }}>
        {settings.data?.length ? (
          settings.data.map((s, i) => (
            <ListRow
              key={s.exercise_id}
              first={i === 0}
              title={s.exercise_name}
              subtitle={[
                s.seat && `Seat ${s.seat}`,
                s.pins && `Pins ${s.pins}`,
                s.back_pad && `Back pad ${s.back_pad}`,
                s.handle && `Handle ${s.handle}`,
                s.notes,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))
        ) : (
          <EmptyState icon="options-outline" title="No machine settings yet" text="Save the seat, pins and handle for a machine from its set screen during a workout." />
        )}
      </Card>
    </>
  );
}

function SavedPhotos({ gym }: { gym: Gym }) {
  const t = useTheme();
  const toast = useToast();
  const photos = useMachinePhotos();
  const mine = (photos.data ?? []).filter((p) => p.gym_id === gym.id);
  return (
    <>
      <Section title="Machine photos" />
      <Txt variant="small" style={{ marginTop: -space.xs, marginBottom: space.sm }}>
        Photos you confirmed. A new photo is compared with these first, so a machine is recognised in a fraction of a second. They stay on your server.
      </Txt>
      <PhotoMatchStatusCard />
      <Card>
        {mine.length ? (
          <View style={styles.grid}>
            {mine.map((p) => (
              <View key={p.id} style={[styles.tile, { backgroundColor: t.surface2 }]}>
                <Image source={{ uri: p.thumbnail }} style={styles.thumb} accessibilityLabel={`Photo of ${p.exercise_name}`} />
                <View style={{ padding: space.sm }}>
                  <Txt variant="label" numberOfLines={2} style={{ color: t.text }}>
                    {p.exercise_name}
                  </Txt>
                  <Txt variant="tiny">
                    {shortDate(p.created_at.slice(0, 10))}
                    {p.corrected ? " · corrected" : ""}
                    {p.matchable ? "" : " · waiting for the model"}
                  </Txt>
                </View>
                <View style={styles.remove}>
                  <IconButton
                    icon="trash-outline"
                    label={`Delete the photo of ${p.exercise_name}`}
                    onPress={async () => {
                      try {
                        await api(`/photo-memory/photos/${p.id}`, { method: "DELETE" });
                        invalidate(qk.machinePhotos, qk.gyms);
                        toast("Photo deleted");
                      } catch (e) {
                        toast(errorMessage(e) ?? "Couldn't delete it");
                      }
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState icon="images-outline" title="No photos yet" text="When you log an exercise from a photo, the machine you pick is remembered here." />
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
  remove: { position: "absolute", top: space.xs, right: space.xs },
});
