// Serwisy VOD, które Pitayas Watch otwiera na telewizorze.
// hosts     — domeny, na które wolno przejść po przekazaniu z telefonu (i ich poddomeny),
// seek_keys — true: przewijanie strzałkami (odtwarzacz serwisu nie znosi zmiany czasu wprost, np. Netflix),
//             false: ustawiamy czas elementu <video>.
pub struct Service {
    pub id: &'static str,
    pub name: &'static str,
    pub hosts: &'static [&'static str],
    pub seek_keys: bool,
}

/// Krok przewijania strzałką w serwisach z `seek_keys` (sekundy)
pub const KEY_STEP: f64 = 10.0;

pub const SERVICES: &[Service] = &[
    Service { id: "netflix", name: "Netflix", hosts: &["netflix.com"], seek_keys: true },
    Service { id: "disney", name: "Disney+", hosts: &["disneyplus.com"], seek_keys: true },
    Service { id: "prime", name: "Prime Video", hosts: &["primevideo.com", "amazon.com", "amazon.pl"], seek_keys: true },
    Service { id: "hbo", name: "HBO Max", hosts: &["hbomax.com", "max.com"], seek_keys: false },
    Service { id: "skyshowtime", name: "SkyShowtime", hosts: &["skyshowtime.com"], seek_keys: false },
    Service { id: "apple", name: "Apple TV", hosts: &["tv.apple.com"], seek_keys: false },
    Service { id: "canal", name: "CANAL+", hosts: &["canalplus.com"], seek_keys: false },
    Service { id: "player", name: "Player", hosts: &["player.pl"], seek_keys: false },
    Service { id: "tvp", name: "TVP VOD", hosts: &["vod.tvp.pl"], seek_keys: false },
    Service { id: "polsat", name: "Polsat Box Go", hosts: &["polsatboxgo.pl"], seek_keys: false },
    Service { id: "youtube", name: "YouTube", hosts: &["youtube.com", "youtu.be"], seek_keys: false },
];

pub fn service_for_host(host: &str) -> Option<&'static Service> {
    let host = host.to_lowercase();
    SERVICES.iter().find(|s| s.hosts.iter().any(|d| host == *d || host.ends_with(&format!(".{d}"))))
}

pub struct Checked {
    pub url: String,
    pub host: String,
    pub service: Option<&'static Service>,
}

/// Adres z telefonu: tylko https; domyślnie tylko znane serwisy (ustawienie „anyHost” zdejmuje to ograniczenie)
pub fn check_url(raw: &str, any_host: bool) -> Result<Checked, String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "Niepoprawny adres".to_string())?;
    if u.scheme() != "https" {
        return Err("Tylko adresy https://".into());
    }
    let host = u.host_str().unwrap_or("").to_string();
    let service = service_for_host(&host);
    if service.is_none() && !any_host {
        return Err(format!("Nieznany serwis ({host}) — włącz „Dowolne strony” w Pitayas Watch na telewizorze"));
    }
    Ok(Checked { url: u.to_string(), host, service })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adresy() {
        assert!(check_url("http://www.netflix.com/watch/1", false).is_err());
        assert!(check_url("https://example.com/film", false).is_err());
        assert!(check_url("https://example.com/film", true).is_ok());
        assert!(check_url("https://evilnetflix.com/", false).is_err());
        assert!(check_url("javascript:alert(1)", true).is_err());
        let c = check_url("https://www.netflix.com/watch/80100172", false).unwrap();
        assert_eq!(c.service.unwrap().id, "netflix");
        assert!(c.service.unwrap().seek_keys);
        assert_eq!(check_url("https://youtu.be/abc", false).unwrap().service.unwrap().id, "youtube");
    }
}
