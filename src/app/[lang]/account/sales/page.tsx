import { OrderList } from "@/components/OrderList";
import { requireViewer } from "@/lib/auth";
import { runJobs } from "@/lib/market";
import { ordersOf } from "@/lib/orders";
import { getDictionary, getLocale } from "../../dictionaries";

export default async function SalesPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/account/sales`);
  await runJobs().catch((error) => console.error("[jobs]", error));
  const orders = await ordersOf(viewer.user.id, "seller");
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-3xl">{dict.order.salesTitle}</h1>
      <OrderList rows={orders} dict={dict} locale={locale} />
    </div>
  );
}
