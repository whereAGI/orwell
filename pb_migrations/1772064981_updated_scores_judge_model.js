/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("scores");

    // Add judge_model field to scores for bench tracking
    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "score_judge_f1",
        "name": "judge_model",
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
    const collection = dao.findCollectionByNameOrId("scores");

    collection.schema.removeField("score_judge_f1");

    return dao.saveCollection(collection);
})
