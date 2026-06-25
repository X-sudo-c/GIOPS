-- Ghana power grid test seed data

BEGIN;

-- Connectivity node identified objects
INSERT INTO identified_objects (mrid, name, lifecycle_state, validation) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Pokuaa Bulk Supply Point (BSP)', 'IN_SERVICE', 'APPROVED'),
  ('a0000000-0000-0000-0000-000000000002', 'Anyaa Junction Feeder Sub-Node', 'IN_SERVICE', 'APPROVED'),
  ('a0000000-0000-0000-0000-000000000003', 'Mallam Secondary Distribution Node', 'IN_SERVICE', 'APPROVED');

INSERT INTO connectivity_nodes (mrid, boundary_feeder_id, geom) VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    'FEEDER-GRIDCO-POKUAA-01',
    ST_SetSRID(ST_MakePoint(-0.2941, 5.6812), 4326)
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'FEEDER-ECG-ANYAA-11K',
    ST_SetSRID(ST_MakePoint(-0.2891, 5.6104), 4326)
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    'FEEDER-ECG-MALLAM-04',
    ST_SetSRID(ST_MakePoint(-0.2810, 5.5721), 4326)
  );

INSERT INTO ghana_grid_assets (mrid, operating_utility, substation_name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'GRIDCO_TRANSMISSION', 'Pokuaa BSP'),
  ('a0000000-0000-0000-0000-000000000002', 'ECG_SOUTHERN', 'Anyaa Junction'),
  ('a0000000-0000-0000-0000-000000000003', 'ECG_SOUTHERN', 'Mallam');

-- Line segment identified objects
INSERT INTO identified_objects (mrid, name, lifecycle_state, validation) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Pokuaa-Anyaa 33kV Intertie Conductor', 'IN_SERVICE', 'APPROVED'),
  ('e0000000-0000-0000-0000-000000000002', 'Anyaa-Mallam 11kV Conductor Trunk', 'IN_SERVICE', 'APPROVED');

INSERT INTO conducting_equipment (mrid, phases, nominal_voltage, serial_number) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'ABC', 'MV_33KV', 'GRIDCO-WIRE-P-A'),
  ('e0000000-0000-0000-0000-000000000002', 'ABC', 'MV_11KV', 'ECG-WIRE-A-M');

INSERT INTO ac_line_segments (mrid, source_node_id, target_node_id, direction_downstream, geom) VALUES
  (
    'e0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    TRUE,
    ST_SetSRID(
      ST_MakeLine(
        ST_MakePoint(-0.2941, 5.6812),
        ST_MakePoint(-0.2891, 5.6104)
      ),
      4326
    )
  ),
  (
    'e0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    TRUE,
    ST_SetSRID(
      ST_MakeLine(
        ST_MakePoint(-0.2891, 5.6104),
        ST_MakePoint(-0.2810, 5.5721)
      ),
      4326
    )
  );

COMMIT;
