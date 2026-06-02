import { assertEquals } from "#test-assert";
import { hasSalesTemplateVariables } from "../render-cron-template.ts";

Deno.test("hasSalesTemplateVariables detects payment_category_summary token", () => {
  assertEquals(hasSalesTemplateVariables("{{payment_category_summary}}"), true);
  assertEquals(
    hasSalesTemplateVariables("Cierre {{time}} {{payment_category_summary}}"),
    true,
  );
  assertEquals(hasSalesTemplateVariables("Mensaje fijo"), false);
});
