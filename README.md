# Photo Frame

Simple local photo viewer hosted from this app folder.

## Run

```bash
npm start
```

The server listens on port `8080` by default and prints local and LAN URLs. Use `PORT=8090 npm start` to choose another port.

## iPhone Safari Clipboard Import

iPhone Safari requires HTTPS before it exposes clipboard APIs on a LAN URL. Create a local CA, generate a server certificate, trust the CA on the iPhone, then run the HTTPS server.

From the URLs printed by `npm start`, ignore `localhost` and open each IP-based URL from the iPhone. Use the one that loads. Set `LAN_IP` to only that IP address, with no `http://` and no port.

For example, if the iPhone can open `http://192.168.1.164:8080`, run:

```bash
LAN_IP=192.168.1.164
```

```bash
LAN_IP=192.168.1.164 npm run certs
```

If you installed a previous Photo Frame certificate profile, remove it from the iPhone first. Send the new `certs/photo-frame-ca.pem` to the iPhone, install the profile, then enable full trust in Settings > General > About > Certificate Trust Settings.

```bash
npm run start:https
```

Open `https://<LAN_IP>:8443/add` in Safari. If Safari shows a native Paste callout after tapping `Add from Clipboard`, choose Paste. Pasting directly into the URL field also imports valid URLs.

## Photos

Imported photos are stored as files in `photos/`. Source URLs are not saved.

Open `/add` or use the floating `+` button in the viewer to import a photo by URL.

This app is intended for trusted local-network use only.
