export class FactionSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["legacy-war", "sheet", "faction"],
      template: "systems/legacy-war/templates/faction-sheet.html",
      width: 640,
      height: 560,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "territories" }]
    });
  }

  getData() {
    const data = super.getData();
    data.territories = data.items.filter(i => i.type === "territory");
    data.powers = data.items.filter(i => i.type === "power");
    data.totalValue = data.territories.reduce((sum, t) => sum + t.data.value, 0);
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.options.editable) return;

    html.find(".missile-add").click(ev => {
      this.actor.update({ "data.missiles": this.actor.data.data.missiles + 1 });
    });
    html.find(".missile-remove").click(ev => {
      this.actor.update({ "data.missiles": Math.max(0, this.actor.data.data.missiles - 1) });
    });
    html.find(".item-edit").click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.getOwnedItem(li.data("itemId"));
      item.sheet.render(true);
    });
    html.find(".item-delete").click(ev => {
      const li = $(ev.currentTarget).parents(".item");
      new Dialog({
        title: "Delete?",
        content: "<p>Delete this item?</p>",
        buttons: {
          yes: { label: "Yes", callback: () => this.actor.deleteOwnedItem(li.data("itemId")) },
          no: { label: "No" }
        },
        default: "no"
      }).render(true);
    });
    html.find(".item-create").click(ev => {
      const type = ev.currentTarget.dataset.type;
      this.actor.createOwnedItem({ name: `New ${type}`, type: type });
    });
    html.find(".earn-star").click(async ev => {
      const roll = new Roll("1d6").roll();
      if (roll.total >= 5) {
        await this.actor.update({ "data.stars": this.actor.data.data.stars + 1 });
      }
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: `<span class="lw-star">★</span> ${this.actor.name} tries to earn a star`
      });
    });
  }
}
