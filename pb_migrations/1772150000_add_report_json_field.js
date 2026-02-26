/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("7hazsf4ww827yqf"); // reports

    // Add report_json field (JSON type)
    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "rptjson01",
        "name": "report_json",
        "type": "json",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "maxSize": 5000000
        }
    }));

    return dao.saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("7hazsf4ww827yqf");

    collection.schema.removeField("rptjson01");

    return dao.saveCollection(collection);
})
