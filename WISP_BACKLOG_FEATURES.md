# Wisp — Backlog Features & Priorities

> Backlog for Wisp, a local-first DJ prep assistant that turns a chaotic folder of analysed tracks into a smart, playable mix plan.
>
> This backlog assumes the core implementation plan already covers: library scanning, Mixed in Key metadata reading, recommendations, mix chain building, audio preview/blend, cue helper, metadata cleanup, Artist Refresh, and Crate Digger.

---

## Priority model

| Priority | Meaning |
|---|---|
| **P0** | Highest-value additions that directly strengthen the core Wisp loop: choose track → recommend → audition → build mix. |
| **P1** | Strong product features that add depth once the core loop is working. |
| **P2** | Nice-to-have polish, dashboards, exports, and workflow helpers. |
| **P3** | Experimental or rabbit-hole features. Cool, but should not block the main app. |

---

# Recommended implementation order

## 1. Transition feedback and ratings

**Priority:** P0  
**Recommended phase:** After Phase 4 Audio Preview / Blend  
**Why:** This turns Wisp from a static recommendation engine into something that learns from your actual taste.

### Summary

After previewing a transition between two tracks, the user can rate whether the blend worked.

Example ratings:

```text
🔥 Works great
👍 Good
😐 Maybe
❌ Doesn't work
```

### Value

This is one of the strongest backlog features because it creates a personal feedback loop.

Wisp can eventually learn:

- which types of transitions you actually like
- which artists/styles clash despite matching metadata
- which BPM/key jumps work in practice
- which pairs should be recommended again

### Data model

```csharp
public class TransitionFeedback
{
    public Guid Id { get; set; }
    public Guid FromTrackId { get; set; }
    public Guid ToTrackId { get; set; }
    public int Rating { get; set; } // 1-5
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

### MVP behaviour

- User previews two adjacent tracks.
- User rates the transition.
- Rating is stored.
- Future recommendation rows can show: `Previously rated: Works great`.

### Later behaviour

- Recommendation score includes prior feedback.
- Highly rated pairs get boosted.
- Poorly rated pairs get penalised.
- Wisp can surface "proven transitions".

---

## 2. Mix plan quality warnings

**Priority:** P0  
**Recommended phase:** During or shortly after Phase 3 Mix Chain Builder  
**Why:** It makes the chain builder instantly more useful and helps users spot weak points in a planned mix.

### Summary

Wisp should flag potentially bad transitions or awkward set flow.

Example warnings:

```text
Large BPM jump: 124 → 132
Energy cliff: 8 → 4
Key clash: 8A → 3B
Same artist appears twice within 3 tracks
Three vocal-heavy tracks in a row
```

### Value

The app should not just say which tracks are good. It should help explain where a mix chain might go wrong.

This makes Wisp feel like a set-planning assistant, not just a sortable track table.

### MVP behaviour

- Analyse adjacent tracks in a mix chain.
- Show warning icons between cards.
- Expand warning to show the reason.

### Suggested warning rules

```text
BPM jump > 6 BPM
Energy change >= 4
Camelot incompatible key move
Same artist within last 3 tracks
Missing BPM/key/energy metadata
Two vocal-heavy tracks adjacent, if role tags exist
```

---

## 3. Track role tags

**Priority:** P0  
**Recommended phase:** After Phase 2 Recommendation Engine, before advanced recommendation work  
**Why:** DJ usefulness goes way beyond genre. Role tags let recommendations understand how tracks are used in a set.

### Summary

Let users tag tracks by purpose or vibe.

Example tags:

```text
Opener
Warm-up
Builder
Peak-time
Closer
Emergency banger
Tool
Percussive
Vocal-heavy
Instrumental
Dub
Dark
Uplifting
Garagey
Tribal
Deep
```

### Value

Role tags are often more useful than genre tags.

A track can be `House`, but that does not tell you whether it is a warm-up tune, a peak-time tune, a vocal moment, or a transition tool.

### MVP behaviour

- Add manual tags to a track.
- Filter library/recommendations by tag.
- Show tags on track cards.

### Later behaviour

- Recommendation modes use tags.
- Mix plan quality warnings use tags.
- Energy curve templates use tags.
- Vocal clash detection uses tags.

### Data model

```csharp
public class TrackTag
{
    public Guid Id { get; set; }
    public Guid TrackId { get; set; }
    public string Name { get; set; } = "";
    public TrackTagType Type { get; set; }
}

public enum TrackTagType
{
    Role,
    Vibe,
    Vocal,
    Era,
    Custom
}
```

---

## 4. Anchor-based mix planning

**Priority:** P1  
**Recommended phase:** After the basic mix chain and recommendation engine are stable  
**Why:** This is one of the most exciting future features and gives Wisp a unique identity.

### Summary

The user pins important tracks into a plan, then Wisp suggests tracks to connect them.

Example:

```text
Start with this track
Must include this track halfway
End with this track
```

Wisp then suggests a route:

```text
7A / 124 BPM / E5
→ 7A / 125 BPM / E6
→ 8A / 126 BPM / E6
→ 8A / 128 BPM / E7
→ 9A / 130 BPM / E8
```

### Value

This turns Wisp from "what track goes next?" into "help me build a proper set journey".

### MVP behaviour

- User marks one or more tracks as anchors.
- User asks Wisp to suggest tracks between anchors.
- Wisp ranks candidate routes based on BPM, key, energy, tags, and transition quality.

### Later behaviour

- Multiple route styles: Safe, Energy Build, Darker, Vocal Journey, Wildcard.
- User locks certain tracks in place.
- Wisp fills gaps around locked tracks.

---

## 5. Wanted tracks pipeline

**Priority:** P1  
**Recommended phase:** Alongside Artist Refresh / Crate Digger  
**Why:** It connects external discovery back into the local library workflow.

### Summary

External discoveries should not just sit in random lists. They should move through a proper pipeline.

Example statuses:

```text
Discovered
Want
Found digitally
Purchased
Downloaded
Scanned
Analysed
Ready to mix
Ignored
```

### Value

This makes Artist Refresh and Crate Digger feel like part of the Wisp ecosystem rather than bolt-on discovery tabs.

### Workflow

```text
Find tune on YouTube / Discogs / Spotify
        ↓
Mark as Want
        ↓
Find legal digital source
        ↓
Buy/download manually
        ↓
Rescan library
        ↓
Wisp detects local match
        ↓
Track becomes Ready to Mix
```

### MVP behaviour

- Add `Want`, `Already Have`, `Ignore` statuses.
- Show a Want List page.
- Let discovered tracks be matched to local tracks after rescan.

### Later behaviour

- Automatic "this wanted track now exists in your library" detection.
- Purchase/search links.
- Import status history.

---

## 6. “Why this works” transition explanations

**Priority:** P1  
**Recommended phase:** After Phase 2 Recommendation Engine  
**Why:** The app should not just give scores. It should explain the musical logic.

### Summary

For every recommendation or adjacent transition, show a short explanation.

Example:

```text
Why it works:
- Same key: 8A → 8A
- BPM difference: +1.2
- Energy lift: 6 → 7
- Both tagged as deep / vocal house

Suggested approach:
Start Track B during Track A outro. Blend over 32 bars.
```

### Value

This builds trust. It also helps you relearn DJing after a long absence because the app is teaching you why a pairing makes sense.

### MVP behaviour

- Generate text from the existing score breakdown.
- Show explanation in recommendation details.

### Later behaviour

- Include cue info.
- Include phrase length advice.
- Include warnings like "avoid vocal overlap".

---

## 7. “Do not recommend together” rules

**Priority:** P1  
**Recommended phase:** After transition feedback  
**Why:** Sometimes two tracks match technically but sound bad together.

### Summary

Allow the user to block bad pairs.

Example actions:

```text
Never recommend this pair again
Avoid this artist after this artist
Avoid this kind of transition
```

### Data model

```csharp
public class RecommendationBlock
{
    public Guid Id { get; set; }
    public Guid? FromTrackId { get; set; }
    public Guid? ToTrackId { get; set; }
    public string? FromArtist { get; set; }
    public string? ToArtist { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

### MVP behaviour

- Block a specific pair.
- Exclude blocked pairs from recommendations.

---

## 8. “Similar to this, but...” controls

**Priority:** P1  
**Recommended phase:** After basic recommendation modes  
**Why:** This makes discovery feel interactive and intentional.

### Summary

Add quick controls to steer recommendations.

Examples:

```text
Similar but higher energy
Similar but darker
Similar but more vocal
Similar but more garagey
Similar but safer key
Similar but wildcard
```

### Value

This builds naturally on the existing `EnergyMode` and recommendation weights.

### MVP behaviour

- Add filter/modifier pills above recommendations.
- Adjust scoring weights based on selected modifier.

---

## 9. Rediscover forgotten gems

**Priority:** P1  
**Recommended phase:** After mix plan usage history exists  
**Why:** Perfect for someone returning to DJing with a messy older library.

### Summary

Surface tracks the user has not used in any mix plan, or has not opened/listened to recently.

Example:

```text
You haven't used these 40 tracks in any mix plan yet.
These 8 fit your current chain.
```

### Value

This helps the user rediscover their own library, not just external catalogues.

### MVP behaviour

- Track whether a song has appeared in a mix plan.
- Add a library filter: `Unused in any plan`.
- Recommend unused tracks that fit the current seed.

---

# Medium-priority backlog

## 10. Set length planner

**Priority:** P2  
**Recommended phase:** After Mix Chain Builder  
**Why:** Useful and simple.

### Summary

Estimate how long a mix plan is.

Example:

```text
Target: 45 minutes
Current chain: 38 minutes
Estimated with overlaps: 34 minutes
Suggested track count: 9-11 tracks
```

### MVP behaviour

- User enters target mix duration.
- Wisp estimates duration based on track lengths and average overlap.

---

## 11. Energy curve templates

**Priority:** P2  
**Recommended phase:** After Track Role Tags and Mix Chain Builder  
**Why:** Good set-planning UX once the basics exist.

### Summary

Let the user choose a desired energy shape.

Examples:

```text
Slow build
Peak then cool down
Roller
Dark into uplifting
Warm-up to bangers
```

### MVP behaviour

- User chooses a template.
- Wisp warns when the chain does not match the intended curve.

### Later behaviour

- Wisp suggests tracks to match the selected curve.

---

## 12. Vocal clash flag

**Priority:** P2  
**Recommended phase:** After Track Role Tags  
**Why:** Very useful, but manual tagging is enough for v1.

### Summary

Avoid transitions where two vocal-heavy tracks overlap badly.

### MVP behaviour

- Manual tags: `Vocal-heavy`, `Instrumental`, `Dub`, `Acapella`.
- Warn when two vocal-heavy tracks are adjacent.

### Later behaviour

- Audio or metadata-based vocal detection.

---

## 13. Label and era crates

**Priority:** P2  
**Recommended phase:** After metadata cleanup / tagging  
**Why:** Especially good for old-school house.

### Summary

Let users browse and build plans by era, label, or vibe.

Examples:

```text
90s House
Early 00s Funky House
Blog-era 2010s
Defected-style
Subliminal-style
Garagey
Tribal
Deep
```

### MVP behaviour

- Add manual era/vibe tags.
- Filter library and recommendations by tag.

---

## 14. Crate health dashboard

**Priority:** P2  
**Recommended phase:** After scanning and metadata cleanup  
**Why:** Nice overview of the library.

### Summary

Show statistics about the local library.

Example:

```text
Most common BPM range: 124-128
Most common keys: 8A, 9A, 7A
Energy spread: mostly 6-8
Missing BPM: 42 tracks
Missing key: 17 tracks
Duplicate candidates: 23
Artists with no recent tracks: 14
```

### Value

Good for library cleanup and planning, but not core to the recommendation loop.

---

## 15. Duplicate and near-duplicate detection

**Priority:** P2  
**Recommended phase:** After metadata cleanup safety is in place  
**Why:** Useful, but can get fiddly.

### Summary

Detect more than exact file duplicates.

Examples:

```text
Same artist/title but different file
Radio Edit vs Extended Mix
320 MP3 vs WAV
Same track with different filename
Same track from a compilation album
```

### MVP behaviour

- Show possible duplicates.
- User manually marks which one to keep.
- No automatic deletion.

### Guardrail

Never delete or overwrite files automatically.

---

## 16. Practice session mode

**Priority:** P2  
**Recommended phase:** After Mix Plans and Transition Feedback  
**Why:** Great for actually using saved plans.

### Summary

A focused practice view for a saved mix plan.

Example screen:

```text
Current track
Next track
Cue in/out notes
Transition reason
Rating buttons
Mark as practised
```

### Value

This turns Wisp into a prep and rehearsal tool, not just a planning tool.

---

## 17. Mix notes export

**Priority:** P2  
**Recommended phase:** After Mix Plans and Cue Points  
**Why:** Useful, straightforward, and good polish.

### Summary

Export a mix plan as CSV, markdown, or PDF-style notes.

Example fields:

```text
Order
Artist - Title
BPM
Key
Energy
Cue in
Cue out
Transition note
Reason it was selected
```

### MVP behaviour

- Export as Markdown and CSV.
- PDF can come later.

---

# Lower-priority / experimental backlog

## 18. Smart “next 3 options” routes

**Priority:** P3  
**Recommended phase:** After recommendations and anchor planning  
**Why:** Cool, but algorithmically deeper.

### Summary

Instead of only recommending individual next tracks, recommend short routes.

Example:

```text
Safe route:
A → B → C

Energy route:
A → D → E

Wildcard route:
A → F → G
```

### Value

This is a more advanced version of the recommendation engine and could become a standout feature.

---

## 19. Constraint-based mix generation

**Priority:** P3  
**Recommended phase:** Much later  
**Why:** Very cool, but should not derail v1.

### Summary

User gives constraints and Wisp builds a draft mix.

Example:

```text
Build a 30-minute old-school house mix
Start at energy 5
End at energy 8
Keep BPM between 124 and 130
Avoid duplicate artists
Use at least 2 vocal tracks
```

### MVP behaviour

- Generate a draft chain from constraints.
- User manually reviews and edits.

### Warning

This is tempting, but it should come after manual mix planning feels excellent.

---

## 20. AI-assisted mix notes

**Priority:** P3  
**Recommended phase:** Much later  
**Why:** Nice optional feature, but not needed for the core product.

### Summary

Use an LLM to generate readable mix notes from structured transition data.

Example:

```text
This transition should feel smooth because both tracks sit in 8A and only differ by 1 BPM. Track B has a slight energy lift, so it works well as a builder after the first breakdown.
```

### Guardrail

The recommendation logic should remain deterministic. AI should explain or summarise, not decide the core score.

---

# Highest recommendation

If only five backlog features are added first, choose these:

```text
1. Transition feedback and ratings
2. Mix plan quality warnings
3. Track role tags
4. Anchor-based mix planning
5. Wanted tracks pipeline
```

These features best support Wisp's core identity:

> Help the user turn a messy, analysed library into smart, playable mix plans, then learn which transitions actually work for their taste.

---

# Suggested backlog phase map

| Feature | Priority | Suggested timing |
|---|---:|---|
| Transition feedback and ratings | P0 | After Phase 4 |
| Mix plan quality warnings | P0 | During/after Phase 3 |
| Track role tags | P0 | After Phase 2 |
| Anchor-based mix planning | P1 | After Phase 3/4 |
| Wanted tracks pipeline | P1 | During Phase 8/9 |
| “Why this works” explanations | P1 | After Phase 2 |
| Do not recommend together | P1 | After feedback ratings |
| Similar to this, but... | P1 | After Phase 2 |
| Rediscover forgotten gems | P1 | After usage history exists |
| Set length planner | P2 | After Phase 3 |
| Energy curve templates | P2 | After role tags |
| Vocal clash flag | P2 | After role tags |
| Label and era crates | P2 | After tagging/cleanup |
| Crate health dashboard | P2 | After Phase 1/6 |
| Duplicate detection | P2 | After Phase 6 |
| Practice session mode | P2 | After feedback ratings |
| Mix notes export | P2 | After Phase 5 |
| Smart next 3 routes | P3 | After anchor planning |
| Constraint-based mix generation | P3 | Much later |
| AI-assisted mix notes | P3 | Much later |

---

# Product principle

The best backlog features should make Wisp better at answering this question:

> “I’ve got this tune. What can I play with it, will it actually blend well, and how do I build a set that feels intentional?”

Avoid backlog items that pull Wisp toward being a full DJ performance app. Wisp is strongest as a prep, planning, discovery, and transition intelligence tool.
