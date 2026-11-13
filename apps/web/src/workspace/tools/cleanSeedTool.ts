import type { Tool } from '@synthetos/library';

// Exact old values, for the one-time removal of invented starter data (owner, 2026-11-12).
// These are migration fingerprints, never defaults or advice.
const LEGACY: Readonly<Record<string, Pick<Tool, 'notes' | 'life'>>> = {
  "seed.t1": {
    "notes": "Chatters above 24 000 rpm in maple. Keep the stickout at 20 mm.",
    "life": {
      "minutes": 279,
      "byMaterial": [
        {
          "materialRef": {
            "id": "builtin.al-6061",
            "version": 1
          },
          "minutes": 146
        },
        {
          "materialRef": {
            "id": "builtin.acrylic-cast",
            "version": 1
          },
          "minutes": 41
        },
        {
          "materialRef": {
            "id": "builtin.mdf",
            "version": 1
          },
          "minutes": 92
        }
      ]
    }
  },
  "seed.t2": {
    "notes": "",
    "life": {
      "minutes": 38,
      "byMaterial": [
        {
          "materialRef": {
            "id": "builtin.al-6061",
            "version": 1
          },
          "minutes": 38
        }
      ]
    }
  },
  "seed.t3": {
    "notes": "Use 10 % stepover for a smooth finish in walnut.",
    "life": {
      "minutes": 270,
      "byMaterial": [
        {
          "materialRef": {
            "id": "builtin.hardwood",
            "version": 1
          },
          "minutes": 270
        }
      ]
    }
  },
  "seed.t4": {
    "notes": "",
    "life": {
      "minutes": 107,
      "byMaterial": [
        {
          "materialRef": {
            "id": "builtin.al-6061",
            "version": 1
          },
          "minutes": 12
        },
        {
          "materialRef": {
            "id": "builtin.hardwood",
            "version": 1
          },
          "minutes": 95
        }
      ]
    }
  },
  "seed.t5": {
    "notes": "Peck: it packs with aluminium chips past 6 mm.",
    "life": {
      "minutes": 9,
      "byMaterial": [
        {
          "materialRef": {
            "id": "builtin.al-6061",
            "version": 1
          },
          "minutes": 9
        }
      ]
    }
  },
  "seed.t6": {
    "notes": "",
    "life": {
      "minutes": 0,
      "byMaterial": []
    }
  }
};

function sameLife(a: Tool['life'], b: Tool['life']): boolean {
  return a.minutes === b.minutes && a.byMaterial.length === b.byMaterial.length && a.byMaterial.every((entry, i) => {
    const old = b.byMaterial[i]!;
    return entry.minutes === old.minutes && entry.materialRef.id === old.materialRef.id && entry.materialRef.version === old.materialRef.version;
  });
}

/** Idempotent: unchanged records retain identity, so a successful cleanup is never written twice. */
export function cleanSeedTool(tool: Tool): Tool {
  if (!tool.id.startsWith('seed.')) return tool;
  const old = LEGACY[tool.id];
  const cuttingData = tool.cuttingData.filter(row => row.placeholder !== true);
  const notes = old !== undefined && tool.notes === old.notes ? '' : tool.notes;
  const life = old !== undefined && sameLife(tool.life, old.life) && (tool.life.minutes !== 0 || tool.life.byMaterial.length !== 0)
    ? { minutes: 0, byMaterial: [] } : tool.life;
  return cuttingData.length === tool.cuttingData.length && notes === tool.notes && life === tool.life
    ? tool : { ...tool, cuttingData, notes, life };
}
