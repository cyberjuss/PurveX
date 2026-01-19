# Navigation Fix for Alerts Page

The alert cards should navigate to the alert detail page when clicked.

## Key Changes Needed:

1. Ensure the card onClick handler uses the correct route format:
   `/detections/${alert.detection_id}/alerts/${alert.id}`

2. Make sure detection_id is always set when loading alerts

3. The entire card should be clickable, not just the links inside

## Quick Fix:

In the Card component around line 272-296, ensure:

```tsx
<Card
  key={alert.id}
  className="border border-slate-800/50 bg-gradient-to-br from-slate-950/40 via-slate-900/30 to-slate-950/40 backdrop-blur-sm hover:border-slate-700/60 transition-all cursor-pointer group"
  onClick={(e) => {
    // Only navigate if click is not on a link
    if ((e.target as HTMLElement).closest('a')) {
      return;
    }
    // Navigate to alert detail page
    if (alert.detection_id && alert.id) {
      router.push(`/detections/${alert.detection_id}/alerts/${alert.id}`);
    }
  }}
>
```

Make sure `alert.detection_id` is set in the loadData function when mapping alerts.











