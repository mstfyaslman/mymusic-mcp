export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("latitude"));
  const lon = Number(url.searchParams.get("longitude"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const upstream = new URL("https://api.open-meteo.com/v1/forecast");
  upstream.searchParams.set("latitude", String(lat));
  upstream.searchParams.set("longitude", String(lon));
  upstream.searchParams.set("current", "temperature_2m,weather_code");
  upstream.searchParams.set("timezone", "auto");

  try {
    const response = await fetch(upstream.toString(), {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      return Response.json({ error: "Weather provider unavailable" }, { status: 502 });
    }
    const data = await response.json();
    return Response.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return Response.json({ error: "Weather request failed" }, { status: 502 });
  }
}
