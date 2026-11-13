# DESIGN

The goal is to make a community supported map. It's not for real life, it's for a Minecraft server with limited size coordinates. Thus, it's a square map of size 11k x 11k, with coordinates from top left (-5500, -5500) to bottom right (5500, 5500).

Right now, this repo has a lot of functionality for the Nether highway with lines & portals. You can click, hover, search. However, this will no longer be the only layer on this map. There will also be a layer for the "political map", which shows polygons of which countries' land claims exist.

To make this possible we need to define layers. Layers need to be able to have certain objects in them, such as:
- Polygons
  - Name
- Lines
- Landmarks (points)
Objects should all have a unique ID

Ideally it would be nice for all the Nelt map functionality to be generalized in a layer. Functionality is hard because

I am not sure if layers should go in a file or in a database.

Layers should have 1 to many Admins (users) who can approve change requests. Change requests are basically diffs to the layer. Like adding a polygon or changing a polygon's points. Ideally the layer should be formatted in a way that can have diffs.

How would you recommend storing layer data? To start we will likely have 2 big layers and maybe 30 community supported smaller layers. The political map may store 300 polygons, some of which have 100-plus XY points making up their border. Plus metadata for each polygon. 

## Authentication

Authentication is handled by a separate auth system running alongside the map, probably [Authentik](https://goauthentik.io/), which the map uses as an OpenID Connect provider. Users register with their Minecraft player name as their username. Admins and change-request authors are identified by that name.
