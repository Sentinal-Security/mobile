# Sentinal Security — Domain-Driven Architecture & UI/Logic Boundary Specification (DDD)

> **Document Version:** 1.0  
> **Repository:** Mobile Authenticator App (`mobile/`)  
> **Team Structure:** 2-Developer Collaboration Model (Logic / Backend Lead & UI / Visual Designer)  
> **Objective:** Zero-Conflict Architecture for Parallel Logic and UI Development across `backend`, `web`, and `mobile` repositories.

---

## 1. Executive Summary & Team Roles

To enable seamless parallel development between **Logic Implementation** (Backend APIs, state hooks, authentication logic) and **UI/UX Design** ("vibe coding" React Native components, visual assets, layouts), the system enforces strict Domain-Driven Boundaries.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DOMAIN BOUNDARY MODEL                           │
│                                                                        │
│   ┌──────────────────────────────┐    ┌────────────────────────────┐   │
│   │     LOGIC & STATE LAYER      │    │     UI / DESIGN LAYER      │   │
│   │  (API, Hooks, Validation)    │    │ (Components, Styling, UX)  │   │
│   ├──────────────────────────────┤    ├────────────────────────────┤   │
│   │ • API REST Contracts         │    │ • React Native Stylesheets │   │
│   │ • Auth Custom Hooks          │ ──►│ • Unstyled Wrapper Props   │   │
│   │ • State Machine (Idle/Error) │    │ • Layouts, Cards, Themes   │   │
│   └──────────────────────────────┘    └────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Ownership & Merge Protection Matrix

| Repository / Module | Logic Lead Ownership | UI Designer Ownership | Conflict Prevention Rule |
| :--- | :--- | :--- | :--- |
| **Backend Gateway (`backend/`)** | `src/main/java/**` (Controllers, Models, Services) | *No Edits Required* | Full backend isolation. |
| **Web IAM Portal (`web/`)** | `app/api/**`, `hooks/useAuth.ts`, `lib/api.ts` | `components/ui/**`, `app/**/page.tsx` | Logic hooks expose clean state. |
| **Mobile Authenticator (`mobile/`)** | `services/api.ts`, `hooks/useMfaEngine.ts` | `components/**`, `app/(tabs)/**` screen layouts | Logic encapsulated in custom hooks; UI views render props and bind triggers. |

---

## 3. Protected CI/CD APK Pipeline (No-Edit Policy)

* `mobile/.github/workflows/build-apk.yml` and target architecture `arm64-v8a` are strictly protected pipelines.
