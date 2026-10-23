/**
 * The system's Item document. Registered in the init hook as `CONFIG.Item.documentClass`.
 */
export default class SystemItem extends foundry.documents.Item {

  /**
   * Roll data for this item's formula: the owning Actor's data plus this item's data under `@item`.
   * @override
   */
  getRollData() {
    const data = this.actor?.getRollData() ?? {};
    data.item = this.system.getRollData?.() ?? { ...this.system };
    return data;
  }

  /**
   * Roll this item's formula (if it has one) and post the result to chat.
   * @returns {Promise<Roll|null>}
   */
  async roll() {
    const formula = this.system.formula;
    if ( !formula ) {
      ui.notifications.warn(game.i18n.format("__PREFIX__.Warning.NoFormula", { name: this.name }));
      return null;
    }
    if ( !Roll.validate(formula) ) {
      ui.notifications.error(game.i18n.format("__PREFIX__.Warning.InvalidFormula", { name: this.name, formula }));
      return null;
    }

    const roll = new Roll(formula, this.getRollData());
    await roll.evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: this.name
    });
    return roll;
  }
}
