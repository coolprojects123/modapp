# Calendar

The Calendar mod syncs HTTP(S) ICS sources through the permission-gated
Electron network API, caches them in its private mod-data directory, and
uses Electron desktop notifications for event reminders. Source lists,
manual events, preferences, and cached calendars remain available offline.

The ICS parser intentionally has limited recurrence and timezone support;
see its source for the current parsing boundaries. Reminders run while the
app is open and the calendar has loaded.