import { ChevronDown, Globe, Heart, History, Radio as RadioIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Empty, Spinner } from "../components/Shelf";
import { StationTile } from "../components/Tiles";
import { countries, countryName, defaultCountry, flag, genres, languageAreas, loadCatalog, searchStations, station, stationsOf, useRadio, type RadioStation } from "../lib/radio";
import { useSettings } from "../lib/settings";
import { showMenuAt } from "../lib/ui";

function StationSection({ title, stations, icon }: { title: string; stations: RadioStation[]; icon?: React.ReactNode }) {
  if (!stations.length) return null;
  return (
    <section className="shelf">
      <header className="shelf-head">
        <h2>
          {icon}
          {title}
        </h2>
        <span className="muted small">{stations.length}</span>
      </header>
      <div className="station-grid">
        {stations.map((s) => (
          <StationTile key={s.id} station={s} context={stations} />
        ))}
      </div>
    </section>
  );
}

export function Radio() {
  const loaded = useRadio((r) => r.catalogLoaded);
  const favorites = useRadio((r) => r.favorites);
  const recents = useRadio((r) => r.recents);
  const set = useSettings((s) => s.set);
  const chosen = useSettings((s) => s.radioCountry);
  const [filter, setFilter] = useState("");
  useEffect(() => void loadCatalog(), []);
  const country = loaded ? (chosen ?? defaultCountry()) : "CH";

  const shelves = useMemo(() => {
    if (!loaded) return [];
    const list = stationsOf(country);
    const out: { title: string; stations: RadioStation[] }[] = [];
    const featured = list.filter((s) => s.featured);
    if (featured.length) out.push({ title: "Featured", stations: featured });
    if (country === "CH") {
      // Switzerland: by language region.
      for (const [code, name] of Object.entries(languageAreas)) {
        const items = list.filter((s) => s.language === code && !s.featured);
        if (items.length) out.push({ title: name, stations: items });
      }
    } else {
      const seen = new Set(featured.map((s) => s.id));
      for (const [code, g] of Object.entries(genres)) {
        const items = list.filter((s) => s.genres[0] === code && !seen.has(s.id));
        items.forEach((s) => seen.add(s.id));
        if (items.length) out.push({ title: g.name, stations: items });
      }
      const rest = list.filter((s) => !seen.has(s.id));
      if (rest.length) out.push({ title: "More Stations", stations: rest });
    }
    return out;
  }, [loaded, country]);

  if (!loaded) return <div className="center-pad"><Spinner size={28} /></div>;

  const pickCountry = (el: Element) =>
    showMenuAt(
      el,
      [...countries()]
        .sort((a, b) => countryName(a).localeCompare(countryName(b)))
        .map((c) => ({ label: `${flag(c)}  ${countryName(c)}`, checked: c === country, action: () => set({ radioCountry: c }) })),
    );

  const results = filter ? searchStations(filter, 60) : [];
  const favs = favorites.map(station).filter((s): s is RadioStation => !!s);
  const recent = recents.map(station).filter((s): s is RadioStation => !!s).slice(0, 8);

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <p className="eyebrow">Live Radio</p>
          <h1 className="country-title">
            <button className="country-pick" onClick={(e) => pickCountry(e.currentTarget)}>
              <span className="flag">{flag(country)}</span> {countryName(country)} <ChevronDown size={22} />
            </button>
          </h1>
        </div>
        <div className="page-tools">
          <input className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search all stations, cities, genres" />
        </div>
      </header>

      {filter ? (
        results.length ? (
          <StationSection title="Stations" stations={results} />
        ) : (
          <Empty icon={<RadioIcon />} title={`No stations for “${filter}”`} />
        )
      ) : (
        <>
          <StationSection title="Favourites" stations={favs} icon={<Heart size={16} />} />
          <StationSection title="Recently Played" stations={recent} icon={<History size={16} />} />
          {shelves.map((s) => (
            <StationSection key={s.title} title={s.title} stations={s.stations} />
          ))}
          <p className="hint center">
            <Globe size={14} /> {allCount()} stations from {countries().length} countries, shipped with Ampli. Song titles come from the stations' streams.
          </p>
        </>
      )}
    </div>
  );
}

const allCount = () => countries().reduce((n, c) => n + stationsOf(c).length, 0).toLocaleString();
