import BaseItemData from "./item-base.mjs";
import { FEATURE_CATEGORIES } from "../config.mjs";

const { StringField } = foundry.data.fields;

/** Abilities granted by an ancestry, class or other source. */
export default class FeatureData extends BaseItemData {

  /** @override */
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "__PREFIX__.Item.feature"];

  /** @override */
  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      // `choices` makes this render as a <select>; values are keys, labels are localization keys.
      category: new StringField({ required: true, initial: "general", choices: FEATURE_CATEGORIES })
    });
  }
}
