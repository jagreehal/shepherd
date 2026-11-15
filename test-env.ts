// Tests never reach models.dev: gate init skips its price lookup. A test that wants one injects fetch.
process.env.SHEPHERD_PRICES_URL ??= "off";
