/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("sx9qq5ieupmiet8");

    // Add bench_id field to audit_jobs
    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "bench_id_f1",
        "name": "bench_id",
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
    const collection = dao.findCollectionByNameOrId("sx9qq5ieupmiet8");

    collection.schema.removeField("bench_id_f1");

    return dao.saveCollection(collection);
})
