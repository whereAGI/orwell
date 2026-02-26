/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("models");

    // Add analysis_persona field to models collection (judge models only use it)
    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "analysis_persona_field",
        "name": "analysis_persona",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "min": null,
            "max": null,
            "pattern": ""
        }
    }));

    return dao.saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("models");
    collection.schema.removeField("analysis_persona_field");
    return dao.saveCollection(collection);
})
