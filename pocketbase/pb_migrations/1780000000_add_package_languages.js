/// <reference path="../pb_data/types.d.ts" />

// Add first-class package implementation language metadata.
// `language_branches` is the source of truth; `languages` is hook-derived for
// simple filtering/display.

const PACKAGE_LANGUAGES = ["typescript", "python", "clojure"];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("packages");

    collection.fields.add(
      new JSONField({
        name: "language_branches",
        required: false,
        maxSize: 4096,
      }),
      new SelectField({
        name: "languages",
        required: false,
        maxSelect: 3,
        values: PACKAGE_LANGUAGES,
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("packages");

    collection.fields.removeByName("language_branches");
    collection.fields.removeByName("languages");

    return app.save(collection);
  }
);
