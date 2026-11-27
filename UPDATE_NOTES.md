# OpenSkies Flight Simulator — update notes

This updated source package contains the following changes:

- A clearer 3D scenery section in Settings, including a Cesium ion token field, Show/Hide and Clear controls, and an at-a-glance token status.
- Token state continues to be saved in the current browser's local storage; the actual token is not included in this source archive.
- Scenery load failures now produce a clearer menu hint explaining that the token permissions or network connection may need attention.
- Photorealistic 3D tile settings request more detail at High, Balanced, and Performance quality levels, while retaining the simulator's adaptive frame-rate controller.
- Settings layout is more readable on desktop and mobile.

## Apply to a deployment

Replace the existing deployed project files with this package and redeploy using the same deployment workflow that currently publishes your game. The source files alone do not change an already deployed website. After redeployment, open Settings in the live game, enter your own Cesium ion browser token, select Photorealistic 3D cities, and Save & reload.

No Cesium token or other API secret is included in this archive. Keep browser tokens restricted to the website origins that need them in Cesium ion.
