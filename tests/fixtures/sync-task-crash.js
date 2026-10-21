// Worker de test : meurt sans répondre.
process.once("message", () => process.exit(3));
