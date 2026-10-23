import { ABILITIES } from "../config.mjs";

const { SchemaField, NumberField, HTMLField } = foundry.data.fields;

/**
 * Data shared by every Actor sub-type. Each sub-type extends this and adds its own fields.
 *
 * A TypeDataModel is what lives at `actor.system`. Document data preparation runs in this order:
 *   1. system.prepareBaseData()      - set up values that Active Effects may modify
 *   2. actor.prepareBaseData()
 *   3. actor.prepareEmbeddedDocuments()   - Active Effects are applied here
 *   4. system.prepareDerivedData()   - compute values from the final source data (below)
 *   5. actor.prepareDerivedData()
 * Anything assigned in the prepare* methods is NOT persisted, only fields returned by defineSchema() are.
 */
export default class BaseActorData extends foundry.abstract.TypeDataModel {

  /**
   * Field labels and hints are auto-localized from lang/en.json using these prefixes:
   * `__PREFIX__.Actor.base.FIELDS.<field path>.label` (and `.hint`). Sub-types append their own prefix.
   */
  static LOCALIZATION_PREFIXES = ["__PREFIX__.Actor.base"];

  /** @override */
  static defineSchema() {
    const requiredInteger = { required: true, nullable: false, integer: true };

    // Build one {value} schema per ability defined in config.mjs.
    // Note: giving a NumberField min, max AND step makes it render as a range slider, so only constrain what you need.
    const abilities = Object.fromEntries(Object.keys(ABILITIES).map(key => [key, new SchemaField({
      value: new NumberField({ ...requiredInteger, initial: 10, min: 0 })
    })]));

    return {
      biography: new HTMLField(),
      hp: new SchemaField({
        value: new NumberField({ ...requiredInteger, initial: 10, min: 0 }),
        max: new NumberField({ ...requiredInteger, initial: 10, min: 1 })
      }),
      abilities: new SchemaField(abilities)
    };
  }

  /** @override */
  prepareDerivedData() {
    for ( const ability of Object.values(this.abilities) ) {
      ability.mod = Math.floor((ability.value - 10) / 2);
    }
    const ratio = this.hp.max > 0 ? this.hp.value / this.hp.max : 0;
    this.hp.pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  }

  /**
   * Data exposed to dice formulas as `@paths`, e.g. `@abilities.might.mod` or the `@might.mod` shortcut below.
   * Return a copy: formulas, Active Effects and callers must never mutate the live model.
   * @returns {object}
   */
  getRollData() {
    const data = { ...this };
    for ( const [key, ability] of Object.entries(this.abilities) ) data[key] = { ...ability };
    return data;
  }
}
