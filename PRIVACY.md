# Fitness App — Privacy Policy

Last updated: 24 November 2026

## Who we are

Fitness App is a fitness and health tracking app built by a small team of university students as a course project. It is in a private pilot with a small group of invited testers. It is not a commercial service: we do not sell anything, show ads or sell data.

The app runs on a server our team operates. This policy explains what the app collects, why, and the choices you have.

## What we collect

We collect only what you enter or choose to connect.

| Data | Examples | Where it comes from |
| --- | --- | --- |
| Account | Email address, password (stored only as a secure hash), sign-up date, whether you agreed to emails | You |
| Profile | Date of birth, sex, height, weight, activity level, goal, diet option, training days, equipment, units | You |
| Activity logs | Workouts, food, weigh-ins, body measurements, sleep entries | You |
| Health data | Sleep (times, duration, stages) and daily step totals | Android Health Connect or Apple Health, if you connect them |
| WHOOP data | Your WHOOP user ID and name, sleep (times, stages, performance) and recovery score | WHOOP, if you connect it |
| Photos | Photos of gym machines you take in the app; ones you confirm are saved so the app recognises your machines | You |
| Voice | Short voice recordings, turned into text on our server; the recording itself is not saved | You |
| Coach chat | Messages you send to the in-app coach and its replies | You |

We do not collect your location, contacts or advertising identifiers.

## Health and wearable connections

Every connection is optional, off until you turn it on, and **read only**: the app never writes to, changes or deletes anything in Health Connect, Apple Health or WHOOP.

| Connection | What the app reads | When | How to stop it |
| --- | --- | --- | --- |
| Android Health Connect | Sleep sessions and daily step totals | Only while the app is open (no background sync) | Disconnect in the app; remove access in Health Connect's settings |
| Apple Health (iPhone) | Sleep analysis and daily step totals | Only while the app is open (no background sync) | Disconnect in the app; remove access in Settings, then Health, then Data Access & Devices |
| WHOOP | Profile (name, user ID), sleep and recovery, using WHOOP's `read:profile`, `read:sleep`, `read:recovery` and `offline` permissions | When you open the app or tap Sync | Disconnect in the app; remove the app's access in your WHOOP account |

For WHOOP, our server stores the access and refresh tokens WHOOP gives us so it can sync without asking you to log in each time. Disconnecting asks WHOOP to cancel that access and deletes the tokens from our server. Data already imported stays in your log until you delete it or your account.

Health data from these connections is used only to show you your own sleep, steps and recovery, and to personalise your plan and coach. It is never used for advertising, never sold, and never shared with data brokers.

## How we use your data

We use your data only to run the app for you:

- Calculate your calorie and training targets and build your workout plan
- Show your history, progress, sleep, steps and recovery
- Give suggestions and answer your questions in the coach
- Recognise gym machines from your photos and log food or workouts from your voice
- Keep the service secure and fix problems during the pilot

We send you marketing emails only if you opt in at sign-up, and every email has a one-click unsubscribe link.

**AI processing.** Speech-to-text, photo recognition and machine matching run on our own server. The coach also runs on our server by default. If the team switches the coach to Anthropic's Claude service, the messages you send the coach, and the parts of your logs it needs to answer, are sent to Anthropic to generate the reply. We will update this policy before that happens.

## Where your data is stored and who sees it

Your data is stored in a database on a computer run by our team for the pilot. The app is reached over an encrypted (HTTPS) connection. Only the student team members who run the pilot can access the server.

We do not sell, rent or trade your data, and we do not share it with advertisers. Outside services receive only what they need:

| Service | What it receives | Why |
| --- | --- | --- |
| WHOOP | Requests made with your WHOOP tokens | To read your WHOOP data when you connect it |
| USDA FoodData Central, Open Food Facts | The food name you search for | To find nutrition values; your identity is not sent |
| Anthropic (only if the coach is switched to it) | Your coach messages and the logs needed to answer | To generate coach replies |

We may disclose data if the law requires it.

## Keeping and deleting your data

We keep your data while your account exists. You can:

- **Delete entries** such as workouts, meals, weigh-ins and sleep in the app at any time
- **Disconnect** Health Connect, Apple Health or WHOOP at any time (see above)
- **Delete your account** in the app: this permanently removes your account and everything linked to it, including imported health and WHOOP data and saved photos
- **Ask us** for a copy of your data, a correction or deletion, using the contact below

When the pilot ends, we will delete pilot data or ask testers before keeping it.

## Security

Passwords are stored only as secure hashes, connections use HTTPS, and each account can see only its own data. No system is perfectly secure, so please use a password you don't use elsewhere.

## Children

The app is not intended for children under 13, and we do not knowingly collect their data. If you believe a child has signed up, contact us and we will delete the account.

## Changes to this policy

If we change how we collect or use data, we will update this page and its "Last updated" date, and tell pilot testers in the app or by email before the change applies.

## Contact

Questions or requests about your data: open an issue on the project's [GitHub repository](https://github.com/EyadAlayed506/fitness-app/issues), or contact the pilot team member who invited you.
