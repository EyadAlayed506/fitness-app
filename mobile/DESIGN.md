# App design and language rules

Owner: Samer. Applies to everything under `mobile/`. Short on purpose — add a rule only when a real screen needs it.
Status: **draft for review** (APP-01, 2026-11-18). Reviewers: Nawaf (language/coach), Alzoman (API/errors).

## Platform

- The pilot runs as a **web app** in phone browsers (WEB-01; group confirmation pending). Native code stays
  working; don't add web-only (DOM) libraries or shortcuts that break Android/iPhone.
- Build on the existing components in `src/components/ui.tsx` (`Screen`, `Card`, `Txt`, `Button`, `Field`,
  `Segmented`, `ListRow`, `EmptyState`, `Skeleton`, `Sheet`, toasts, dialogs). No new design system or UI library.
- Tokens live in `src/lib/theme.ts` (colours for light/dark, `space`, `radius`, `type`, `size`, `motion`).
  Use them instead of raw numbers. Touch targets stay at least 44 pt.

## Language

- **Two languages, together:** every user-visible string is added to both `src/lib/i18n/en.ts` and `ar.ts`.
  The typecheck fails if `ar.ts` is missing a key; a test checks both have the same keys.
- **Use** `const { t } = useI18n()` and `t("area.meaning", { value })`. Keys are `<screen or area>.<meaning>`,
  in English, never shown to users.
- **Counts** use `tn("key", n)`. The text holds the plural forms separated by `|`: English `one|other`,
  Arabic `zero|one|two|few|many|other` (0, 1, 2, 3–10, 11–99, 100+). A test checks Arabic has all six.
  Don't use the old `plural()` helper in translated screens.
- **Outside components** (helpers, option lists), keep **keys** and translate when shown, or use `tr()`/`trCount()`
  from `lib/i18n/current.ts`. Validation problems are stored as keys, not text, so they re-translate on a switch.
- **Placeholders** (`{url}`, `{count}`) are filled by `t()`. In Arabic they are wrapped in Unicode isolates so a URL,
  email, number or English name doesn't reorder the sentence. Don't build sentences by joining strings.
- **IDs stay neutral:** database IDs, enum values (`leg_press`, `health_connect`), API fields and model class names
  are never translated or sent translated. Translate only what is displayed.
- **Errors:** show `errorText(err)` from `useI18n()` for API errors. It maps known server answers to translated
  text; unknown ones show the server's words in English and a general message in Arabic. Keep the error object in
  state (not the text) so it re-translates when the language changes.
- **User and external text** (notes, food product names, coach replies' quoted data) is shown as written.
- **Choice and memory:** the switch shows `English | العربية`, each in its own script. The choice is saved on the
  device (`localStorage` on the web, secure storage on phones). First visit: Arabic if the browser's first language
  is Arabic, else English.
- **Numbers and dates** in Arabic use **Western digits (0–9) and the Gregorian calendar**
  (`ar-u-nu-latn-ca-gregory`, from `locale` in `useI18n()`), matching what users type and what the server stores.
  *Needs Nawaf's confirmation.* The helpers in `src/lib/format.ts` (`fmt`, dates, `hoursMinutes`, `timeAgo`,
  weekday names, `units().weight`) already follow the chosen language.
- **Units:** `units().w` / `.l` are the IDs sent to the API (`kg`, `lb`, `cm`, `in`) — never show them.
  Show `units().wLabel` / `.lLabel` (`كغ`, `سم` in Arabic).

## Right-to-left

- On the web, the provider sets `<html lang dir>`; the browser then mirrors rows, text alignment and inputs.
  No reload needed. On phones, React Native applies the direction from the next app start (not needed for the
  web pilot; checked again before any native build).
- **Write direction-neutral styles:** `marginStart/End`, `paddingStart/End`, `start/end`, `alignItems: "flex-start"`.
  `row` already mirrors. Avoid `marginLeft/Right`, `left/right` and `textAlign: "left"` in new code unless something
  must stay physical (e.g. a chart's time axis). Existing physical styles are fixed screen by screen as they are translated.
- **Icons that point** (back, forward, chevrons, "next") must mirror in Arabic; symmetric icons don't.
  Use `Icon` from `components/ui.tsx` instead of `Ionicons`: it mirrors `chevron-/arrow-/caret-back|forward`
  automatically. `Button`, `IconButton`, `ListRow` already use it.
- **No letter spacing in Arabic:** it breaks joined letters. `Txt` removes it automatically; other `Text` uses must not set it in Arabic.
- Emails, passwords, URLs and numbers typed by the user stay left-to-right inside an Arabic layout (browser default `dir=auto`).
- **Text aligns with the page, not with its own script:** `Txt` sets `textAlign` left (English) or right (Arabic),
  so an Arabic product name in the English app, or an English exercise name in the Arabic app, lines up with the
  rest of the row. Pass `textAlign` in `style` to centre. Plain `Text` elsewhere should do the same.
- Arabic text is often longer/taller: no fixed widths on text, allow two lines on buttons and labels where space is tight.

## States

Every screen that loads data has a loading state (`Skeleton`/`Loading`), an empty state (`EmptyState` with
a next step) and an error state (`ErrorText` or a toast with retry) — all translated.

## Review

Arabic text in `ar.ts` is drafted with AI help and is marked for **human review by an Arabic speaker** before the
pilot. Review per screen, in the running app (meaning in context), not as a word list.
