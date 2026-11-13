//! On-chain art for every NFT: each token's `media` is an SVG data URI drawn by
//! the contract itself, so wallets and marketplaces show a picture with no
//! server, no IPFS and nothing that can go offline.
//!
//! - the living Totem: BaoBao in its palette, mood colours, level hearts, its
//!   Reserve and tonight's real moon. Redrawn on every read (a dynamic NFT).
//! - a gravestone: the life record, frozen.
//! - each badge kind: its own medal.
//!
//! Nothing here is stored: the art is computed in the view methods, so adding
//! it needed no state migration.

use crate::lineage::Traits;

/// (patch, scarf, accent) per palette, the same as the app's 3D panda.
const PALETTES: [(&str, &str, &str); 6] = [
    ("#2b2230", "#ff5d6c", "#ff9db0"),
    ("#1f4f56", "#ffc94a", "#7fd6c8"),
    ("#5a2236", "#7fcf5a", "#ff9fbd"),
    ("#22305a", "#ff9a3c", "#9db8ff"),
    ("#3c4a2a", "#c69cff", "#b6e08f"),
    ("#4a3326", "#5ec8f2", "#f2c49b"),
];

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// `data:image/svg+xml;base64,…`
pub fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", b64(svg.as_bytes()))
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// A moon `lit_bp` lit (0 new … 10 000 full), waxing lit on the right.
fn moon(cx: i32, cy: i32, r: i32, lit_bp: u32, waxing: bool) -> String {
    // the terminator is an ellipse of half-width |1 - 2·lit|·r
    let w = (r as i64 * (10_000 - 2 * lit_bp as i64).abs() / 10_000) as i32;
    let side = if waxing { 1 } else { 0 };
    let lit = "#ffe27a";
    let dark = "#3e4a78";
    // half disc on the lit side, then the terminator ellipse in lit or dark
    let half = format!(
        "<path d='M{cx} {} A{r} {r} 0 0 {side} {cx} {} Z' fill='{lit}'/>",
        cy - r,
        cy + r
    );
    let ell = format!(
        "<ellipse cx='{cx}' cy='{cy}' rx='{w}' ry='{r}' fill='{}'/>",
        if lit_bp > 5_000 { lit } else { dark }
    );
    format!(
        "<circle cx='{cx}' cy='{cy}' r='{}' fill='{lit}' opacity='0.25'/><circle cx='{cx}' cy='{cy}' r='{r}' fill='{dark}'/>{half}{ell}",
        r + 8
    )
}

fn panda(traits: &Traits, dead: bool, egg: bool) -> String {
    let (patch, scarf, accent) = PALETTES[traits.palette as usize % PALETTES.len()];
    let (patch, scarf) = if dead { ("#6b6870", "#8d8a8a") } else { (patch, scarf) };
    let body = if dead { "#d9d6dc" } else { "#fbf8f2" };
    let eyes = if dead {
        "<path d='M168 186l16 16M184 186l-16 16M216 186l16 16M232 186l-16 16' stroke='#2b2230' stroke-width='5' stroke-linecap='round'/>".to_string()
    } else {
        format!("<circle cx='178' cy='196' r='7' fill='#fff'/><circle cx='222' cy='196' r='7' fill='#fff'/><circle cx='180' cy='197' r='4' fill='#2b2230'/><circle cx='224' cy='197' r='4' fill='#2b2230'/><ellipse cx='162' cy='218' rx='10' ry='6' fill='{accent}' opacity='0.7'/><ellipse cx='238' cy='218' rx='10' ry='6' fill='{accent}' opacity='0.7'/>")
    };
    let shell = if egg {
        "<path d='M120 290 l20 -18 l20 18 l20 -18 l20 18 l20 -18 l20 18 l20 -18 l20 18 l20 -18 V330 H120Z' fill='#fff6e0' stroke='#e8d9b0' stroke-width='3'/>"
    } else {
        ""
    };
    format!(
        "<ellipse cx='200' cy='338' rx='96' ry='14' fill='#000' opacity='0.12'/>\
         <ellipse cx='200' cy='272' rx='86' ry='72' fill='{body}'/>\
         <ellipse cx='140' cy='300' rx='26' ry='34' fill='{patch}'/><ellipse cx='260' cy='300' rx='26' ry='34' fill='{patch}'/>\
         <circle cx='138' cy='142' r='26' fill='{patch}'/><circle cx='262' cy='142' r='26' fill='{patch}'/>\
         <circle cx='200' cy='194' r='76' fill='{body}'/>\
         <ellipse cx='176' cy='196' rx='19' ry='24' fill='{patch}' transform='rotate(-20 176 196)'/>\
         <ellipse cx='224' cy='196' rx='19' ry='24' fill='{patch}' transform='rotate(20 224 196)'/>\
         {eyes}<ellipse cx='200' cy='222' rx='9' ry='6' fill='{patch}'/>\
         <path d='M128 252 Q200 282 272 252 L268 270 Q200 298 132 270Z' fill='{scarf}'/>\
         <path d='M246 268 l18 44 l-22 -4Z' fill='{scarf}'/>\
         <path d='M200 118 q-6 -22 8 -30 M200 118 q12 -16 26 -10' stroke='#5fae4a' stroke-width='6' fill='none' stroke-linecap='round'/>{shell}"
    )
}

fn frame(bg_top: &str, bg_bot: &str, inner: &str, title: &str, sub: &str, foot: &str) -> String {
    // light text on the dark (night) backgrounds
    let dark_bg = bg_top.starts_with("#2") || bg_top.starts_with("#4");
    let (ink, ink2) = if dark_bg { ("#fff6d6", "#e6def5") } else { ("#2b2230", "#4a3f52") };
    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400' width='400' height='400'>\
         <defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='{bg_top}'/><stop offset='1' stop-color='{bg_bot}'/></linearGradient></defs>\
         <rect width='400' height='400' rx='28' fill='url(#g)'/>{inner}\
         <text x='200' y='44' text-anchor='middle' font-family='Verdana,sans-serif' font-size='24' font-weight='bold' fill='{ink}'>{}</text>\
         <text x='200' y='70' text-anchor='middle' font-family='Verdana,sans-serif' font-size='14' fill='{ink2}'>{}</text>\
         <rect x='24' y='352' width='352' height='32' rx='16' fill='#fff' opacity='0.75'/>\
         <text x='200' y='373' text-anchor='middle' font-family='Verdana,sans-serif' font-size='13' font-weight='bold' fill='#2b2230'>{}</text></svg>",
        esc(title),
        esc(sub),
        esc(foot)
    )
}

pub struct LiveTotem<'a> {
    pub name: &'a str,
    pub traits: &'a Traits,
    pub level: u32,
    pub max_level: u32,
    pub mood: &'a str,
    pub form: &'a str,
    pub fullness_bp: u32,
    pub reserve_whole: u128,
    pub moon_bp: u32,
    pub waxing: bool,
}

pub fn totem_svg(t: &LiveTotem) -> String {
    let (top, bot) = match t.mood {
        "happy" => ("#bfe6ff", "#e9f8e4"),
        "hungry" => ("#ffe6a8", "#fff5dc"),
        "starving" => ("#ffc4cc", "#ffe9ec"),
        "rampage" => ("#ff7a86", "#ffd1d6"),
        _ => ("#cfd6e6", "#eef0f5"),
    };
    let mut hearts = String::new();
    let n = t.max_level.clamp(1, 7);
    for i in 0..n {
        let c = if i < t.level { "#ff4d6d" } else { "#d8d2db" };
        let y = 150 + i as i32 * 26;
        hearts.push_str(&format!(
            "<path d='M70 {y} l-11 -11 a6.5 6.5 0 0 1 11 -9 a6.5 6.5 0 0 1 11 9Z' fill='{c}' stroke='#fff' stroke-width='2'/>"
        ));
    }
    let belly = (t.fullness_bp.min(10_000) as i32) * 120 / 10_000;
    let inner = format!(
        "{}{hearts}{}\
         <rect x='300' y='130' width='16' height='124' rx='8' fill='#fff' opacity='0.8'/>\
         <rect x='302' y='{}' width='12' height='{belly}' rx='6' fill='#3fbf63'/>",
        moon(338, 66, 22, t.moon_bp, t.waxing),
        panda(t.traits, false, t.form == "egg"),
        252 - belly
    );
    frame(
        top,
        bot,
        &inner,
        t.name,
        &format!("Level {} · {} · {}", t.level, t.form, t.mood),
        &format!("Reserve {} $TOTEM · moon {}% lit", t.reserve_whole, t.moon_bp / 100),
    )
}

pub fn gravestone_svg(name: &str, generation: u32, max_level: u32, traits: &Traits) -> String {
    let inner = format!(
        "<g opacity='0.35'>{}</g>\
         <path d='M130 340 V170 a70 70 0 0 1 140 0 V340Z' fill='#9a97a3' stroke='#6b6870' stroke-width='4'/>\
         <text x='200' y='200' text-anchor='middle' font-family='Georgia,serif' font-size='30' font-weight='bold' fill='#f4f2f6'>R.I.P.</text>\
         <text x='200' y='240' text-anchor='middle' font-family='Georgia,serif' font-size='17' fill='#f4f2f6'>gen {generation}</text>\
         <text x='200' y='270' text-anchor='middle' font-family='Georgia,serif' font-size='15' fill='#f4f2f6'>reached Level {max_level}</text>",
        panda(traits, true, false)
    );
    frame("#4b3f6b", "#9d8fb8", &inner, &format!("🪦 {name}"), "a gravestone of the lineage", "starved at Level 0")
}

/// Medal for a soulbound badge, by token id prefix.
pub fn badge_svg(token_id: &str, title: &str) -> String {
    let kind = token_id.split('-').next().unwrap_or("");
    let tier = token_id.split('-').nth(1).unwrap_or("");
    let (top, bot, ring, icon, label) = match (kind, tier) {
        ("hero", _) => ("#ffb199", "#ffe3d6", "#e8463c", "🦸", "HERO"),
        ("founder", _) => ("#c7f0c2", "#effbe9", "#3f9d5a", "🥚", "FOUNDER"),
        ("returned", _) => ("#b9ecf0", "#e9fbfc", "#2b9aa8", "🤗", "WELCOME BACK"),
        ("moonlit", _) => ("#2a2f5c", "#5b5f9c", "#ffe27a", "🌕", "MOONLIT"),
        ("badge", "gold") => ("#ffe69a", "#fff6d6", "#d4a017", "🥇", "GOLD CARETAKER"),
        ("badge", "silver") => ("#e3e6ec", "#f7f8fb", "#9aa3b5", "🥈", "SILVER CARETAKER"),
        ("badge", _) => ("#f2c9a5", "#fbeee2", "#b06a35", "🥉", "BRONZE CARETAKER"),
        _ => ("#e7e5ea", "#f7f6f8", "#9a97a3", "🏅", "BADGE"),
    };
    let inner = format!(
        "<path d='M160 270 l-26 80 l36 -16 l18 30 l12 -90Z M240 270 l26 80 l-36 -16 l-18 30 l-12 -90Z' fill='{ring}' opacity='0.85'/>\
         <circle cx='200' cy='200' r='96' fill='{ring}'/><circle cx='200' cy='200' r='82' fill='#fff' opacity='0.92'/>\
         <text x='200' y='228' text-anchor='middle' font-size='80'>{icon}</text>"
    );
    frame(top, bot, &inner, label, title, "soulbound · TOTEM on NEAR")
}

/// The collection icon: a small panda face.
pub fn icon_svg() -> String {
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='32' fill='#bfe6ff'/>\
     <circle cx='16' cy='18' r='8' fill='#2b2230'/><circle cx='48' cy='18' r='8' fill='#2b2230'/>\
     <circle cx='32' cy='35' r='22' fill='#fbf8f2'/><ellipse cx='24' cy='34' rx='5' ry='7' fill='#2b2230'/>\
     <ellipse cx='40' cy='34' rx='5' ry='7' fill='#2b2230'/><ellipse cx='32' cy='44' rx='3' ry='2' fill='#2b2230'/></svg>"
        .to_string()
}

#[cfg(test)]
mod t {
    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(super::b64(b""), "");
        assert_eq!(super::b64(b"f"), "Zg==");
        assert_eq!(super::b64(b"fo"), "Zm8=");
        assert_eq!(super::b64(b"foo"), "Zm9v");
        assert_eq!(super::b64(b"foobar"), "Zm9vYmFy");
    }
}

