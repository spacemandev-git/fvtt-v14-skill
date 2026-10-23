/**
 * Static game configuration for the system. Imported by the data models (to build their schemas) and
 * exposed at runtime as `CONFIG.__PREFIX__` (see the init hook in __ID__.mjs) so that other packages
 * can read or extend it.
 *
 * Label values are localization keys, never display text. Localize them at render time.
 */
export const SYSTEM_ID = "__ID__";

/** The ability scores of this tiny ruleset. The data model schema and the sheet are built from this record. */
export const ABILITIES = {
  might: { label: "__PREFIX__.Ability.might.label", abbreviation: "__PREFIX__.Ability.might.abbr" },
  agility: { label: "__PREFIX__.Ability.agility.label", abbreviation: "__PREFIX__.Ability.agility.abbr" },
  wits: { label: "__PREFIX__.Ability.wits.label", abbreviation: "__PREFIX__.Ability.wits.abbr" }
};

/** Categories for "feature" items. A plain record of value -> label key can be used directly as StringField choices. */
export const FEATURE_CATEGORIES = {
  general: "__PREFIX__.Feature.Category.general",
  ancestry: "__PREFIX__.Feature.Category.ancestry",
  class: "__PREFIX__.Feature.Category.class"
};

export const SYSTEM = {
  id: SYSTEM_ID,
  abilities: ABILITIES,
  featureCategories: FEATURE_CATEGORIES
};
